#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TBF Stats Sync
Pulls cycle stat JSON files from the Discord telemetry channel and stores
them in a local SQLite database for balance analysis.

Usage:
    python sync_stats.py          # sync new records + print summary
    python sync_stats.py summary  # print summary only (no sync)

Setup:
    pip install requests
    Copy .env.example to .env and fill in your credentials.
"""

import os
import requests
import sqlite3
import json
import sys
from pathlib import Path

# -- Load .env ----------------------------------------------------------------
def _load_env():
    env_path = Path(__file__).parent / '.env'
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass

_load_env()

# -- Config -------------------------------------------------------------------
BOT_TOKEN  = os.environ.get('TBF_BOT_TOKEN',  '')
CHANNEL_ID = os.environ.get('TBF_CHANNEL_ID', '')

DB_PATH     = str(Path(__file__).parent / 'tbf_stats.db')
CURSOR_FILE = Path(__file__).parent / '.sync_cursor'


# -- Database -----------------------------------------------------------------
def init_db(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cycles (
            ts                TEXT PRIMARY KEY,
            year              INTEGER,
            cycle             INTEGER,
            cycle_in_year     INTEGER,
            samples           INTEGER,
            proposals_done    INTEGER,
            proposals_partial INTEGER,
            failed            INTEGER,
            rep_earned        INTEGER,
            reputation        INTEGER,
            funding           INTEGER,
            ring              INTEGER,
            upgrades          TEXT
        )
    ''')
    conn.commit()


def insert_record(conn, r):
    conn.execute('''
        INSERT OR IGNORE INTO cycles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ''', (
        r['ts'],
        r.get('year'),
        r.get('cycle'),
        r.get('cycleInYear'),
        r.get('samples'),
        r.get('proposalsDone'),
        r.get('proposalsPartial'),
        r.get('failed'),
        r.get('repEarned'),
        r.get('reputation'),
        r.get('funding'),
        r.get('ring'),
        json.dumps(r.get('upgrades', {})),
    ))
    conn.commit()


# -- Discord ------------------------------------------------------------------
def discord_get(path, token, params=None):
    r = requests.get(
        'https://discord.com/api/v10' + path,
        headers={'Authorization': 'Bot ' + token},
        params=params,
    )
    r.raise_for_status()
    return r.json()


def fetch_all_new(channel_id, token, after=None):
    """Return all messages after `after` ID, in chronological order."""
    messages = []
    cursor = after
    while True:
        params = {'limit': 100}
        if cursor:
            params['after'] = cursor
        batch = discord_get('/channels/' + channel_id + '/messages', token, params)
        if not batch:
            break
        messages.extend(batch)
        if len(batch) < 100:
            break
        cursor = max(m['id'] for m in batch)
    return sorted(messages, key=lambda m: m['id'])


# -- Cursor -------------------------------------------------------------------
def load_cursor():
    return CURSOR_FILE.read_text().strip() if CURSOR_FILE.exists() else None


def save_cursor(message_id):
    CURSOR_FILE.write_text(str(message_id))


# -- Sync ---------------------------------------------------------------------
def sync():
    if not BOT_TOKEN or not CHANNEL_ID:
        print('ERROR: Set TBF_BOT_TOKEN and TBF_CHANNEL_ID in .env')
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    cursor = load_cursor()
    new_records = 0
    last_id = cursor

    print('Syncing from channel ' + CHANNEL_ID + '...')
    messages = fetch_all_new(CHANNEL_ID, BOT_TOKEN, after=cursor)

    for msg in messages:
        for att in msg.get('attachments', []):
            if att['filename'].endswith('.json'):
                try:
                    r = requests.get(att['url'])
                    r.raise_for_status()
                    record = r.json()
                    insert_record(conn, record)
                    new_records += 1
                    print('  + Y' + str(record.get('year')) +
                          ' C' + str(record.get('cycleInYear')) +
                          ' - ' + str(record.get('samples')) + ' samples' +
                          '  (' + str(record.get('ts', '')) + ')')
                except Exception as e:
                    print('  ! Skipped ' + att['filename'] + ': ' + str(e))
        if not last_id or int(msg['id']) > int(last_id or 0):
            last_id = msg['id']

    if last_id and last_id != cursor:
        save_cursor(last_id)

    conn.close()
    print('\n' + str(new_records) + ' new record(s) synced -> ' + DB_PATH)


# -- Summary ------------------------------------------------------------------
def summary():
    if not Path(DB_PATH).exists():
        print('No database yet - run sync first.')
        return

    conn = sqlite3.connect(DB_PATH)

    total, = conn.execute('SELECT COUNT(*) FROM cycles').fetchone()
    if total == 0:
        print('Database is empty.')
        conn.close()
        return

    row = conn.execute('''
        SELECT
            ROUND(AVG(samples), 1),  MAX(samples),
            ROUND(AVG(proposals_done), 1),
            ROUND(AVG(rep_earned), 1),
            ROUND(AVG(reputation), 0), MAX(reputation),
            ROUND(AVG(funding), 0),    MAX(funding),
            ROUND(AVG(failed), 2)
        FROM cycles
    ''').fetchone()

    avg_s, max_s, avg_pd, avg_re, avg_rep, max_rep, avg_f, max_f, avg_fail = row

    print()
    print('-- TBF Stats Summary ------------------------------------------')
    print('  Cycles recorded        : ' + str(total))
    print('  Samples/cycle  avg/max : ' + str(avg_s) + ' / ' + str(max_s))
    print('  Proposals done avg     : ' + str(avg_pd))
    print('  Rep earned     avg     : ' + str(avg_re))
    print('  Reputation     avg/max : ' + str(avg_rep) + ' / ' + str(max_rep))
    print('  Funding        avg/max : $' + str(avg_f) + ' / $' + str(max_f))
    print('  Failures/cycle avg     : ' + str(avg_fail))

    years = conn.execute('''
        SELECT year,
               COUNT(*) AS cycles,
               ROUND(AVG(samples),1) AS avg_samples,
               ROUND(AVG(rep_earned),1) AS avg_rep
        FROM cycles
        GROUP BY year
        ORDER BY year
    ''').fetchall()

    if len(years) > 1:
        print()
        print('  Per year:')
        for y, c, s, re in years:
            print('    Year ' + str(y) + ': ' + str(c) + ' cycle(s), ' +
                  str(s) + ' samples/cycle avg, ' + str(re) + ' rep earned avg')

    conn.close()


# -- Entry point --------------------------------------------------------------
if __name__ == '__main__':
    if 'summary' in sys.argv:
        summary()
    else:
        sync()
        summary()
