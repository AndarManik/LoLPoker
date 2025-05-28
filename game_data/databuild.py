import io
import sys
import math
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

def load_last_n_days(prefix: str, days: int, dayspurge: int, folder: str = ".", *,
                     purge_old: bool = True):
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)
    purge_date = now - timedelta(days=dayspurge)
    merged = defaultdict(champ_dict)
    folder_path = Path(folder)

    for file in folder_path.glob(f"*{prefix}_*.json"):
        date_part = file.stem.split("_")[-1]
        try:
            file_date = datetime.strptime(date_part, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            print(f"Skipping {file.name}: date not parseable")
            continue

        if file_date < start_date:
            if purge_old and file_date < purge_date:
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

def compute_error(w, l):
    n = w + l
    if n <= 0:return 0.0
    p = w / n
    return math.sqrt(p * (1 - p) / n)

def make_zscore_bucket_classifier(values, errors):
    """
    Build a classifier that buckets z-scores into [0,1,2,4] based on
    the 40th, 70th, and 90th percentiles of a Normal(0,1).

    values : list or array of observed win-rates p_i
    errors : list or array of their measurement errors e_i

    The between-champion variance σ² is estimated by subtracting the
    mean(e_i²) from Var(p_i).  In classify(), each z is computed as
        z = (p - μ) / sqrt(σ² + e²)
    so that low-sample points get “softened.”
    """
    values = np.array(values, dtype=float)
    errors = np.array(errors, dtype=float)

    # population mean of p_i
    mu = np.mean(values)
    # raw variance of p_i
    var_p = np.var(values, ddof=0)
    # subtract average measurement-error variance
    mean_error_sq = np.mean(errors**2)
    corrected_var = var_p - mean_error_sq
    sigma_between = math.sqrt(corrected_var) if corrected_var > 0 else 0.0

    scale = 5/3
    sum = 0

    for i in range(0,5):
        sum += scale ** i

    # percentile cut-points in z-space
    z1 = norm.ppf(scale ** 4 / sum)
    z2 = norm.ppf((scale ** 4 + scale ** 3) / sum)
    z3 = norm.ppf((scale ** 4 + scale ** 3 + scale ** 2) / sum)
    z4 = norm.ppf((scale ** 4 + scale ** 3 + scale ** 2 + scale ** 1) / sum)

    def classify(p, e):
        """
        p : observed win-rate
        e : its measurement error (as from compute_error)
        """
        if sigma_between == 0: return 0
        denom = math.sqrt(sigma_between**2 + e**2)
        if denom == 0: z = 0.0
        else: z = (p - mu) / denom
        if z < z1: return 0
        elif z < z2: return 1
        elif z < z3: return 2
        elif z < z4: return 4
        else: return 8

    return classify

import math

def normalized_winrate(a, b):
    """
    Compute the “normalized” win rate for two champions with solo win rates a and b.

    Args:
        a: Win rate of champion A (0 < a < 1)
        b: Win rate of champion B (0 < b < 1)

    Returns:
        c: Normalized expected win rate of the pair.
    """
    # turn probabilities into log-odds
    la = math.log(a / (1 - a))
    lb = math.log(b / (1 - b))

    # average log-odds
    lm = 0.5 * (la + lb)

    # back to probability
    return 1 / (1 + math.exp(-lm))



def build_game_data():
    '''
        Get the data from the last 30 days and compile into two dicts
    '''
    # Load data from last 5 days
    winrate_data = load_last_n_days("winrate", 28, 28, 'game_data/')
    synergy_data = load_last_n_days("synergy", 28, 28, 'game_data/')
    print("Data load success")
    
    match_count = 0
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
        match_count += v['wins'] + v['losses']
        lanes.get(lane, {})[champion] = {
            'n': champion,
            'g': v['wins'] + v['losses'],
            'w': v['wins'] / (v['wins'] + v['losses']),
            'e': compute_error(v['wins'], v['losses']),
            's': {
                'TOP':{}, 
                'MIDDLE': {}, 
                'JUNGLE':{}, 
                'BOTTOM':{}, 
                'UTILITY': {}
            }
        }
    match_count /= 10
    # Fill synergy maps from synergy_data
    for k, v in synergy_data.items():
        champion1, champion2, lane1, lane2 = k.split("+")
        if not lane1 or not lane2: continue
        if lane1 == lane2: continue
        if champion1 == champion2: continue
        if champion1 not in lanes[lane1]: continue
        if champion2 not in lanes[lane2]: continue
        games_played = v['wins'] + v['losses']
        if games_played < 75: continue
        
        average_winrate = normalized_winrate(lanes[lane1][champion1]['w'], lanes[lane2][champion2]['w'])        
        pair_winrate = v['wins'] / games_played
        
        pair_error = compute_error(v['wins'], v['losses'])
        
        delta_winrate = pair_winrate  - average_winrate
        lanes[lane1][champion1]['s'][lane2][champion2] = {
            'g': games_played,
            'w': delta_winrate,
            'e': pair_error,
        }
        lanes[lane2][champion2]['s'][lane1][champion1] = {
            'g': v['wins'] + v['losses'],
            'w': delta_winrate,
            'e': pair_error,
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
    champ_errors = [champion['e'] for champions in lanes.values() for champion in champions.values()]
    strength_score = make_zscore_bucket_classifier(champ_values, champ_errors)

    for champions in lanes.values():
        for champion in champions.values():
            champion['p'] = strength_score(champion['w'], champion['e'])

    synergy_values = [
        schampion['w']
        for champions in lanes.values()
        for champion in champions.values()
        for schampions in champion['s'].values()
        for schampion in schampions.values()
    ]
    
    synergy_errors = [
        schampion['e']
        for champions in lanes.values()
        for champion in champions.values()
        for schampions in champion['s'].values()
        for schampion in schampions.values()
    ]
    synergy_score = make_zscore_bucket_classifier(synergy_values, synergy_errors)

    for champions in lanes.values():
        for champion in champions.values():
            for schampions in champion['s'].values():
                for schampion in schampions.values():
                    schampion['p'] = synergy_score(schampion['w'], schampion['e'])
        
    formated_lane = {}
    champion_powers = []
    score_distribution = {0: 0, 1: 0, 2: 0, 4: 0, 8: 0}
    synergy_distribution = {0: 0, 1: 0, 2: 0, 4: 0, 8: 0}

    for lane, champions in lanes.items():
        formated_lane[lane] = []
        for champion in champions.values():
            champion_power = champion['p']
            synergy = {}
            delta = {}
            
            for slane, schampions in champion['s'].items():
                power_sum = 0
                count = 0
                synergy[slane] = {}
                delta[slane] = {}
                
                for k, v in schampions.items():
                    synergy[slane][k] = v['p']
                    delta[slane][k] = v['w']
                    power_sum += v['p']
                    count += 1
                    synergy_distribution[v['p']] += 1
                    
                if count == 0: continue
                power_sum /= count
                champion_power += power_sum
            
            champion_power = math.floor(champion_power * 100) / 100
            formated_lane[lane].append({
                'name': champion['n'],
                'lane': lane,
                'points': champion['p'],
                'power': champion_power,
                'winrate': champion['w'],
                'synergy': synergy,
                'delta': delta
            })
            
            score_distribution[champion['p']] += 1

            
            champion_powers.append([champion['n']+ " " + lane, champion_power])
            
    champion_powers.sort(key=lambda x: x[1])
    for champ in champion_powers:
        print(champ[1],champ[0])
    print("Number of Champions: ", len(champion_powers))
    print(score_distribution)
    print(synergy_distribution)
    
    synergy_powers = []
    for lane1, champions1 in formated_lane.items():
        for lane2, champions2 in formated_lane.items():
            if lane1 <= lane2: continue
            for champion1 in champions1:
                for champion2 in champions2:
                    name1 = champion1['name']
                    name2 = champion2['name']
                    if name1 == name2: continue
                    
                    synergy_power = champion1['points'] + champion2['points']
                    synergy_power += champion1['synergy'][lane2][name2]
                    
                    for lane3, champions3 in formated_lane.items():
                        if lane1 == lane3 or lane2 == lane3: continue
                        syn_sum = 0
                        syn_cnt = 0
                        for champion3 in champions3:
                            if name1 == champion3['name']: continue
                            if name2 == champion3['name']: continue
                            syn_sum += champion3['synergy'][lane1][name1]
                            syn_sum += champion3['synergy'][lane2][name2]
                            syn_cnt += 1
                        synergy_power += 1.0 * syn_sum / syn_cnt
                    synergy_powers.append({
                        'champ1': f'{name1} {lane1}',
                        'champ2': f'{name2} {lane2}', 
                        'strength': synergy_power
                    })
                    
                    
    synergy_powers.sort(key=lambda x: x['strength'])       
                
    formated_lane['_meta'] = {
        "champ_count": len(champion_powers),
        "score_distribution": score_distribution,
        "synergy_distribution": synergy_distribution,
        "match_count": match_count,
        "champion_powers": champion_powers,
        "synergy_powers": synergy_powers
    }
    with open('game_data.json', 'w') as f:
        json.dump(formated_lane, f, indent=2)
    
    print("game_data.json success")
    
import matplotlib.pyplot as plt
    
def plot_champs():
    winrate_data = load_last_n_days("winrate", 28, 28, 'game_data/')
    synergy_data = load_last_n_days("synergy", 28, 28, 'game_data/') 
    
    def internal(input):
        match_count = 0
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
            match_count += v['wins'] + v['losses']
            lanes.get(lane, {})[champion] = {
                'n': champion,
                'g': v['wins'] + v['losses'],
                'w': v['wins'] / (v['wins'] + v['losses']),
                'e': compute_error(v['wins'], v['losses']),
                's': {
                    'TOP':{}, 
                    'MIDDLE': {}, 
                    'JUNGLE':{}, 
                    'BOTTOM':{}, 
                    'UTILITY': {}
                }
            }
        match_count /= 10
        # Fill synergy maps from synergy_data
        for k, v in synergy_data.items():
            champion1, champion2, lane1, lane2 = k.split("+")
            if not lane1 or not lane2: continue
            if lane1 == lane2: continue
            if champion1 == champion2: continue
            if champion1 not in lanes[lane1]: continue
            if champion2 not in lanes[lane2]: continue
            games_played = v['wins'] + v['losses']
            if games_played < input: continue
            
            average_winrate = normalized_winrate(lanes[lane1][champion1]['w'], lanes[lane2][champion2]['w'])        
            pair_winrate = v['wins'] / games_played
            
            pair_error = compute_error(v['wins'], v['losses'])
            
            delta_winrate = pair_winrate  - average_winrate
            lanes[lane1][champion1]['s'][lane2][champion2] = {
                'g': games_played,
                'w': delta_winrate,
                'e': pair_error,
            }
            lanes[lane2][champion2]['s'][lane1][champion1] = {
                'g': v['wins'] + v['losses'],
                'w': delta_winrate,
                'e': pair_error,
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

        return sum(len(champs) for champs in lanes.values())
    x = range(1, 500, 25)
    y = [ internal(ix) for ix in x]
    plt.plot(x, y, marker='o', linestyle='-', color='blue', label='y = x^2')

    # Add title and labels
    plt.title('Line Graph Example')
    plt.xlabel('X-axis')
    plt.ylabel('Y-axis')

    # Show legend
    plt.legend()

    # Display the plot
    plt.show() 
# Test
if __name__ == "__main__":
    #plot_champs()
    build_game_data()