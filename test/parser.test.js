import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKill, decodeLog} from '../src/parser.js';
const sample = '2026.03.11-15.19.14: Died: ACN_Edi (76561197961754021), Killer: BP_Guard_Lvl_4_C (NPC) Weapon: Weapon_DEagle_50_C [Projectile] Distance: 9.16 m';
test('parses SCUM death summary',()=> assert.deepEqual(parseKill(sample), {timestamp:'2026.03.11-15.19.14',victim:'ACN_Edi',killer:'BP_Guard_Lvl_4_C',killerType:'NPC',weapon:'Weapon_DEagle_50_C [Projectile]',distance:9.16}));
test('ignores JSON continuation',()=> assert.equal(parseKill('{"Killer":{"ProfileName":"Guard"}}'),null));
test('decodes UTF-16LE logs',()=> assert.equal(decodeLog(Buffer.from(sample,'utf16le')),sample));
