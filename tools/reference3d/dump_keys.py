"""Write the key frames of every blocking-model action to tools/h3-prompts/action_keys.json, for tools/pack_enemies.py to cut takes at strong poses.
blender -b --factory-startup -noaudio --python tools/reference3d/dump_keys.py
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creatures import CREATURES

table = {entity: {action: dict(keys=list(spec.get('keys', ())), travel=spec.get('travel', 0)) for action, spec in creature['actions'].items()} for entity, creature in CREATURES.items()}
with open('tools/h3-prompts/action_keys.json', 'w', encoding='utf8', newline='\n') as fh:
    json.dump(table, fh, indent=1)
print('KEYS_DONE', len(table))
