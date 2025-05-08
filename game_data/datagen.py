import os
import gc
import json
import time
import random
import requests
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime, UTC
from collections import deque, defaultdict
from databuild import build_game_data

import traceback

load_dotenv()
API_KEY = os.getenv("RIOT_API_KEY")
if not API_KEY: raise ValueError("Add RIOT_API_KEY into .env")
REGION = os.getenv("REGION", "na1")
MATCH_REGION = os.getenv("MATCH_REGION", "americas")
QUEUE = 420

class RateLimiter:
    def __init__(self):
        self.short = deque()
        self.long = deque()
        self.next = 0

    def wait(self):
        while True:
            now = time.time()
            if now < self.next:
                time.sleep(self.next - now)
                continue
            while self.short and now - self.short[0] > 1: self.short.popleft()
            while self.long and now - self.long[0] > 120: self.long.popleft()
            if len(self.short) < 20 and len(self.long) < 100: break
            time.sleep(0.05)
        now = time.time()
        self.short.append(now)
        self.long.append(now)

    def backoff(self, duration):
        self.next = max(self.next, time.time() + duration)

rate_limiter = RateLimiter()

def limited_get(url):
    while True:
        rate_limiter.wait()
        response = requests.get(url, headers={"X-Riot-Token": API_KEY})
        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", 1))
            print(f"Rate limited! Backing off for {retry_after} seconds.")
            rate_limiter.backoff(retry_after)
            time.sleep(retry_after)
            continue
        response.raise_for_status()
        return response.json()


def get_diamond_plus_seed():
    data = limited_get(f"https://{REGION}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/DIAMOND/I")
    seed = []
    for entry in data[:1]:
        summoner_id = entry['summonerId']
        try:
            puuid = get_puuid(summoner_id)
            seed.append({"summonerId": summoner_id, "puuid": puuid})
            print(f"Puuid for {summoner_id}")
        except Exception as e: print(f"Failed puuid get{summoner_id}: {e}")
    return seed


def get_puuid(summoner_id): return limited_get(f"https://{REGION}.api.riotgames.com/lol/summoner/v4/summoners/{summoner_id}")["puuid"]


def get_match_ids(puuid, count=5): return limited_get(f"https://{MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?count={count}&queue={QUEUE}")


def get_match_data(match_id): return limited_get(f"https://{MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/{match_id}")

def normalize_key(champ1, champ2, lane1, lane2):
    direction = (lane1, champ1) <= (lane2, champ2)
    if direction: return f"{champ1}+{champ2}+{lane1}+{lane2}"
    else: return f"{champ2}+{champ1}+{lane2}+{lane1}"



def stream_dump(obj, file_path: str, *, ensure_ascii: bool = False) -> None:
    enc = json.JSONEncoder(ensure_ascii=ensure_ascii,separators=(",", ":"))
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        for chunk in enc.iterencode(obj): f.write(chunk)

def save_data(winrates: dict, synergy: dict) -> None:
    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    stream_dump(winrates, f"game_data/winrate_{date_str}.json")
    stream_dump(synergy,  f"game_data/synergy_{date_str}.json")
    print(f"Saved data for {date_str}")

def champ_dict(): return {"wins": 0, "losses": 0}

def load_existing_data():
    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    winrate_path = Path(f"game_data/winrate_{date_str}.json")
    synergy_path = Path(f"game_data/synergy_{date_str}.json")

    if winrate_path.exists(): 
        with open(winrate_path, "r") as f:
            winrates = json.load(f)
    else: winrates = {}

    if synergy_path.exists():
        with open(synergy_path, "r") as f:
            synergy = json.load(f)
    else: synergy = {}

    return defaultdict(champ_dict, winrates), \
           defaultdict(champ_dict, synergy)


def get_rank(summoner_id):
    url = f"https://{REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/{summoner_id}"
    try:
        entries = limited_get(url)
        for entry in entries:
            if entry["queueType"] == "RANKED_SOLO_5x5": return entry["tier"]
    except Exception as e: print(f"Failed rank check{summoner_id}: {e}")
    return False

def is_emerald_plus(rank): return rank in ["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]


import time

time.sleep(10)  # sleep for 10 seconds so server can start first

MAX_MATCHES = 2000
MAX_PUUIDS = 100

# Initialize
seed_dict = {p["puuid"]: p for p in get_diamond_plus_seed()}
known_puuids = set(seed_dict)
known_puuids_queue = deque(known_puuids, maxlen=MAX_PUUIDS)

known_matches = set()
known_matches_queue = deque(maxlen=MAX_MATCHES)

winrates, synergy = load_existing_data()

last_save_time = time.time()
last_date_str = None
print("seed_list generated")

try:
    while True:
        player = random.choice(list(seed_dict.values()))
        summoner_id = player["summonerId"]
        puuid = player["puuid"]

        rank = get_rank(summoner_id)
        if not is_emerald_plus(rank):
            print(f"Skip {puuid[:10]} not Emerald+")
            continue

        #print(f"Processing {puuid[:10]} {rank}")

        try:
            match_ids = get_match_ids(puuid, count=20)
            for match_id in match_ids:
                if match_id in known_matches: continue

                known_matches_queue.append(match_id)
                known_matches.add(match_id)
                if len(known_matches_queue) > MAX_MATCHES:
                    old = known_matches_queue.popleft()
                    known_matches.discard(old)

                match = get_match_data(match_id)
                #print(f"processing: {match_id[:10]}")
                if match['info']['queueId'] != QUEUE:
                    del match
                    continue

                participants = match['info']['participants']
                teams = {100: [], 200: []}
                for p in participants:
                    champ = p['championName']
                    lane = p['teamPosition']
                    key = f"{champ}+{lane}"
                    if p['win']: winrates[key]["wins"] += 1
                    else: winrates[key]["losses"] += 1
                    teams[p['teamId']].append((champ, lane))

                    ppuuid = p['puuid']
                    if ppuuid not in known_puuids:
                        known_puuids_queue.append(ppuuid)
                        known_puuids.add(ppuuid)
                        seed_dict[ppuuid] = {
                            "summonerId": p["summonerId"],
                            "puuid": ppuuid
                        }
                        if len(known_puuids_queue) > MAX_PUUIDS:
                            removed = known_puuids_queue.popleft()
                            known_puuids.discard(removed)
                            seed_dict.pop(removed, None)

                for team_champs in teams.values():
                    for i in range(len(team_champs)):
                        for j in range(i + 1, len(team_champs)):
                            champ1, lane1 = team_champs[i]
                            champ2, lane2 = team_champs[j]
                            key = normalize_key(champ1, champ2, lane1, lane2)
                            win = participants[i]['win']
                            if win: synergy[key]["wins"] += 1
                            else: synergy[key]["losses"] += 1

                del match  # Explicitly release large object

            print(f"Processed {summoner_id[:10]}")
            save_data(winrates, synergy)

            current_date_str = datetime.now(UTC).strftime("%Y-%m-%d")
            if current_date_str != last_date_str:
                winrates.clear()
                synergy.clear()
                build_game_data()
                last_date_str = current_date_str

            if time.time() - last_save_time > 30:
                gc.collect()
                last_save_time = time.time()

        except Exception as e:
            traceback.print_exc()
            print(f"Error summoner {summoner_id[:10]}: {e}")

except KeyboardInterrupt:
    print("Interrupted by user. Saving progress...")
    save_data(winrates, synergy)
    print("Data saved. Exiting cleanly.")
