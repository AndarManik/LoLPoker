import io
import sys
import json
import itertools
import numpy as np
from pathlib import Path
from scipy.stats import norm
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# Force stdout/stderr to UTF-8 (regardless of Node/concurrently/env settings)
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    # fallback for older Python – risks breaking concurrent piping
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def champ_dict(): return {"wins": 0, "losses": 0}

def load_last_n_days(prefix: str, days: int, folder: str = ".", *,
                     purge_old: bool = True):
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)
    merged = defaultdict(champ_dict)
    folder_path = Path(folder)

    for file in folder_path.glob(f"{prefix}_*.json"):
        date_part = file.stem.split("_")[-1]
        try:
            file_date = datetime.strptime(date_part, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            print(f"Skipping {file.name}: date not parseable")
            continue

        if file_date < start_date:
            if purge_old:
                try:
                    file.unlink()
                    print(f"Deleted outdated file {file.name}")
                except Exception as e:
                    print(f"Could not delete {file.name}: {e}")
            continue

        try:
            with file.open("r", encoding="utf-8") as f:  # 👈 force utf-8
                data = json.load(f)
            for key, value in data.items():
                merged[key]["wins"]   += value.get("wins",   0)
                merged[key]["losses"] += value.get("losses", 0)
        except Exception as e:
            print(f"Skipping {file.name}: {e}")

    return merged

def verify_synergy_coverage(lanes):
    remaining = [(c, l) for l in lanes for c in lanes[l]]
    missing = []

    for i in range(len(remaining)):
        champ1, lane1 = remaining[i]
        for j in range(i + 1, len(remaining)):
            champ2, lane2 = remaining[j]
            if champ1 == champ2: continue
            if lane1 == lane2: continue
            # Check both directions
            valid = (
                champ2 in lanes[lane1][champ1]['s'][lane2] and
                champ1 in lanes[lane2][champ2]['s'][lane1]
            )
            if not valid: missing.append((champ1, lane1, champ2, lane2))

    if not missing:
        print("✅ Full synergy coverage verified.")
        return True, []
    else:
        print(f"❌ Missing {len(missing)} synergy entries.")
        for entry in missing[:10]: print("  Missing:", entry)
        if len(missing) > 10: print("  ...more not shown.")
        return False, missing

def make_zscore_bucket_classifier(values):
    mean = np.mean(values)
    std = np.std(values)
    z1 = norm.ppf(0.40)
    z2 = norm.ppf(0.70)
    z3 = norm.ppf(0.90)

    def classify(value):
        if std == 0: return 0
        z = (value - mean) / std
        if z < z1: return 0
        elif z < z2: return 1
        elif z < z3: return 2
        else: return 4

    return classify


def build_game_data():
    '''
        Get the data from the last 30 days and compile into two dicts
    '''
    # Load data from last 5 days
    winrate_data = load_last_n_days("winrate", 30, 'game_data/')
    synergy_data = load_last_n_days("synergy", 30, 'game_data/')
    print("Data load success")
    
    lanes = {
        'TOP':{}, 
        'MIDDLE': {}, 
        'JUNGLE':{}, 
        'BOTTOM':{}, 
        'UTILITY': {}
    }
    # Fill lanes from winrate_data
    for k, v in winrate_data.items():
        champion, lane = k.split('+')
        lanes.get(lane, {})[champion] = {
            'n': champion,
            'g': v['wins'] + v['losses'],
            'w': v['wins'] / (v['wins'] + v['losses']),
            's': {
                'TOP':{}, 
                'MIDDLE': {}, 
                'JUNGLE':{}, 
                'BOTTOM':{}, 
                'UTILITY': {}
            }
        }
    # Fill synergy maps from synergy_data
    for k, v in synergy_data.items():
        champion1, champion2, lane1, lane2 = k.split("+")
        if not lane1 or not lane2: continue
        if lane1 == lane2: continue
        if champion1 == champion2: continue
        if champion1 not in lanes[lane1]: continue
        if champion2 not in lanes[lane2]: continue
        average_winrate = lanes[lane1][champion1]['w'] 
        average_winrate += lanes[lane2][champion2]['w']
        average_winrate /= 2
        games_played = v['wins'] + v['losses']
        lanes[lane1][champion1]['s'][lane2][champion2] = {
            'g': games_played,
            'w': v['wins'] / games_played - average_winrate,
        }
        lanes[lane2][champion2]['s'][lane1][champion1] = {
            'g': v['wins'] + v['losses'],
            'w': v['wins'] / games_played - average_winrate,
        }
    
    print("data parse success")

    '''
        All champions need to have data with all other champions in other roles.
        We remove champions until our data is correct.
        This is a Heuristic Hitting Set Algorithm
    ''' 

    # We use role variable to not clash with lane variable names
    
    # Preprocess
    champion_role_pool = [(champ, role) 
                          for role, champions in lanes.items() 
                          for champ in champions]
    games_played = { (champ, role): lanes[role][champ]['g'] 
                    for champ, role in champion_role_pool }

    # Build all inter-role synergy pairs and reverse index
    required_synergy_pairs = set()
    pairs_by_champion = defaultdict(set)
    for (c1, r1), (c2, r2) in itertools.combinations(champion_role_pool, 2):
        if c1 == c2 or r1 == r2: continue
        pair = ((c1, r1), (c2, r2))
        required_synergy_pairs.add(pair)
        pairs_by_champion[(c1, r1)].add(pair)
        pairs_by_champion[(c2, r2)].add(pair)

    # Function to check if a synergy is satisfied
    def is_synergy_ok(pair1, pair2):
        (c1, r1) = pair1
        (c2, r2) = pair2
        return (
            c2 in lanes[r1][c1]['s'][r2] and
            c1 in lanes[r2][c2]['s'][r1]
        )


    # Initial unsatisfied pair tracking
    unsatisfied_synergy_pairs = { pair 
                                 for pair in required_synergy_pairs 
                                 if not is_synergy_ok(*pair) }

    unsatisfied_count = defaultdict(int)
    for (c1, r1), (c2, r2) in unsatisfied_synergy_pairs:
        unsatisfied_count[(c1, r1)] += 1
        unsatisfied_count[(c2, r2)] += 1

    removed_champions = set()
    
    def cost(item): return (item[1], -games_played.get(item[0], 1e9))

    while unsatisfied_synergy_pairs:
        # Find worst offender
        worst_offender = max(
            unsatisfied_count.items(),
            key=cost
        )[0]

        removed_champions.add(worst_offender)
        champ_to_remove, role_to_remove = worst_offender
        del lanes[role_to_remove][champ_to_remove]

        # Update affected pairs only
        affected_pairs = pairs_by_champion.pop(worst_offender, set())
        for pair in affected_pairs:
            if pair not in required_synergy_pairs: continue
            required_synergy_pairs.remove(pair)
            unsatisfied_synergy_pairs.discard(pair)

            for cr in pair:
                if cr != worst_offender:
                    pairs_by_champion[cr].discard(pair)
                    unsatisfied_count[cr] = max(0, unsatisfied_count[cr] - 1)

        del unsatisfied_count[worst_offender]

    # Clean up synergies
    for lane, champions in lanes.items():
        for champion in champions.values():
            for slane, schampions in champion['s'].items():
                for schampion in list(schampions.keys()):
                    if schampion not in lanes[slane]:
                        del champion['s'][slane][schampion]

    champ_count = sum(len(champs) for champs in lanes.values())
    print(f"Remaining champions: {champ_count}")

    # Verify hitting set
    success, missing_synergies = verify_synergy_coverage(lanes)
    assert success, "Some synergy pairs are missing!"

    '''
        Assign points to champions and synergies according to z-score bucketing
    '''
    
    champ_values = [champion['w'] for champions in lanes.values() for champion in champions.values()]
    strength_score = make_zscore_bucket_classifier(champ_values)

    for champions in lanes.values():
        for champion in champions.values():
            champion['p'] = strength_score(champion['w'])
            del champion['w']
            del champion['g']

    synergy_values = [
        schampion['w']
        for champions in lanes.values()
        for champion in champions.values()
        for schampions in champion['s'].values()
        for schampion in schampions.values()
    ]
    synergy_score = make_zscore_bucket_classifier(synergy_values)

    for champions in lanes.values():
        for champion in champions.values():
            for schampions in champion['s'].values():
                for schampion in schampions.values():
                    schampion['p'] = synergy_score(schampion['w'])
                    del schampion['w']
                    del schampion['g']
        
    formated_lane = {}
    
    for lane, champions in lanes.items():
        formated_lane[lane] = []
        for champion in champions.values():
            synergy = {}
            for slane, schampions in champion['s'].items():
                synergy[slane] = {}
                for k, v in schampions.items():
                    synergy[slane][k] = v['p']
            
            formated_lane[lane].append({
                'name': champion['n'],
                'lane': lane,
                'points': champion['p'],
                'synergy': synergy
            })
                    
    with open('game_data.json', 'w') as f:
        json.dump(formated_lane, f, indent=2)
    
    print("game_data.json success")
# Test
if __name__ == "__main__":
    build_game_data()