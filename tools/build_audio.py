"""Extract the game's sounds (champions, monsters, HUD, Summoner's Rift music) from Wwise banks into mp3 files.

Usage: python tools/build_audio.py <wwiser.py> <out_dir> <DATA/FINAL dir>

Needs vgmstream-cli and ffmpeg on PATH (brew install vgmstream ffmpeg) and wwiser (github.com/bnnm/wwiser).
Each bank (<name>_events.bnk + <name>_audio.bnk/.wpk) is extracted, wwiser writes one .txtp per event
(the event -> action -> container -> .wem tree) and vgmstream renders it. Events are matched by id
(FNV-1 of the lowercase event name, the names come from the champion/monster .bin files), so no
wwnames.txt is needed. Random containers render up to MAX_VARIANTS takes; switch containers (music)
render every state. Writes <out_dir>/<key>_<n>.mp3 and <out_dir>/sounds.json ({key: [files]}).
"""
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from extract_lol import Wad

MAX_VARIANTS = 4
SFX = "assets/sounds/wwise2016/sfx/"
SHARED = SFX + "shared/"
EZ = "Play_sfx_Ezreal_Ezreal"
SA = "Play_sfx_Samira_Samira"
BR = "Play_sfx_Brand_Brand"
BP = "Play_sfx_Brand_P_"
AP = "Play_sfx_Aphelios_Aphelios"
AS = "Play_sfx_AurelionSol_AurelionSol"
TE = "Play_sfx_Teemo_Teemo"
TM = "Play_sfx_TeemoMushroom_TeemoRTrap_"
LX = "Play_sfx_Lux_Lux"
ZG = "Play_sfx_Ziggs_Ziggs"
SV = "Play_sfx_Sivir_Sivir"
GP = "Play_sfx_Gangplank_Gangplank"
OR = "Play_sfx_Orianna_Orianna"
TW = "Play_sfx_Twitch_Twitch"

# bank path (without _events/_audio) -> {sound key: event name candidates (first match wins) or an event id}
BANKS: dict[str, dict[str, list[str] | int]] = {
    SFX + "characters/ezreal/skins/base/ezreal_base_sfx": {
        "ezreal_auto": [EZ + "BasicAttack_OnCast"],
        "ezreal_auto2": [EZ + "BasicAttack2_OnCast"],
        "ezreal_auto_hit": [EZ + "BasicAttack_OnHit"],
        "ezreal_crit": [EZ + "CritAttack_OnCast"],
        "ezreal_crit_hit": [EZ + "CritAttack_OnHit"],
        "ezreal_Q": [EZ + "Q_OnCast"],
        "ezreal_Q_hit": [EZ + "Q_OnHit"],
        "ezreal_W": [EZ + "W_OnCast"],
        "ezreal_W_hit": [EZ + "W_OnHit"],
        "ezreal_W_detonate": [EZ + "WAttach_detonate"],
        "ezreal_E": [EZ + "E_OnCast"],
        "ezreal_E_hit": [EZ + "EMissile_OnHit"],
        "ezreal_R": [EZ + "R_OnCast"],
        "ezreal_R_launch": [EZ + "R_OnMissileCast"],
        "ezreal_R_hit": [EZ + "R_OnHit"],
        "ezreal_death": ["Play_sfx_Ezreal_Death3D_cast"],
    },
    SFX + "characters/samira/skins/base/samira_base_sfx": {
        "samira_auto": [SA + "BasicAttack_OnCast"],
        "samira_auto2": [SA + "BasicAttack2_OnCast"],
        "samira_auto_hit": [SA + "BasicAttack_OnHit"],
        "samira_crit": [SA + "CritAttack_OnCast"],
        "samira_crit_hit": [SA + "CritAttack_OnHit"],
        "samira_melee": [SA + "BasicAttackMelee_OnCast"],
        "samira_melee2": [SA + "BasicAttackMelee2_OnCast"],
        "samira_melee_crit": [SA + "CritAttackMelee_OnCast"],
        "samira_melee_hit": [SA + "BasicAttackMelee_OnHit", SA + "BasicAttackMelee2_OnHit"],
        "samira_melee_crit_hit": [SA + "CritAttackMelee_OnHit"],
        "samira_style": [SA + "PassiveCombo_style_cast"],
        "samira_R_ready": [SA + "RReadyBuff_OnBuffActivate"],
        "samira_Q": [SA + "QGun_OnCast"],
        "samira_Q_hit": [SA + "QGun_OnHit"],
        "samira_Q_slash": [SA + "QSword_OnHit"],
        "samira_W": [SA + "W_OnCast"],
        "samira_W_hit": [SA + "W_hit"],
        "samira_W_block": [SA + "W_hit_block_sml"],
        "samira_E": [SA + "E_cast"],
        "samira_E_hit": [SA + "E_hit"],
        "samira_R": [SA + "R_OnCast"],
        "samira_R_shot": [SA + "RMissile_OnMissileCast"],
        "samira_death": ["Play_sfx_Samira_Death3D_cast"],
    },
    SFX + "characters/brand/skins/base/brand_base_sfx": {
        "brand_auto": [BR + "BasicAttack_OnCast"],
        "brand_auto2": [BR + "BasicAttack2_OnCast"],
        "brand_auto_hit": [BR + "BasicAttack_OnHit", BR + "BasicAttack2_OnHit"],
        "brand_crit": [BR + "CritAttack_OnCast"],
        "brand_crit_hit": [BR + "CritAttack_OnHit"],
        "brand_Q": [BR + "Q_OnCast"],
        "brand_Q_launch": [BR + "QMissile_OnMissileLaunch"],
        "brand_Q_hit": [BR + "QMissile_hit"],
        "brand_W": [BR + "W_OnCast"],
        "brand_W_charge": [BR + "W_buffactivate"],
        "brand_W_hit": [BR + "W_hit"],
        "brand_E": [BR + "E_OnCast"],
        "brand_E_hit": [BR + "E_hit"],
        "brand_E_spread": [BR + "E_OnMissileLaunch"],
        "brand_E_spread_hit": [BR + "EMissile_OnHit"],
        "brand_R": [BR + "R_OnCast"],
        "brand_R_launch": [BR + "RMissile_OnMissileLaunch"],
        "brand_R_bounce": [BR + "RMissile2_OnMissileLaunch", BR + "RMissile3_OnMissileLaunch"],
        "brand_R_hit": [BR + "R_hit"],
        "brand_detonate": [BP + "detonate1", BP + "detonate2"],
        "brand_death": ["Play_sfx_Brand_Death3D_cast"],
    },
    SFX + "characters/aphelios/skins/base/aphelios_base_sfx": {
        "aphelios_calibrum_auto": [AP + "CalibrumAttack_OnCast"],
        "aphelios_calibrum_line": [AP + "CalibrumLineAttack_OnCast", AP + "CalibrumLineAttack_cast"],
        "aphelios_W_calibrum": [AP + "WCalibrum_swap"],
        "aphelios_severum_auto": [AP + "SeverumAttack_OnCast"],
        "aphelios_severum_line": [AP + "SeverumLineAttack_OnCast", AP + "SeverumLineAttack_cast"],
        "aphelios_W_severum": [AP + "WSeverum_swap"],
        "aphelios_gravitum_auto": [AP + "GravitumAttack_OnCast"],
        "aphelios_gravitum_line": [AP + "GravitumLineAttack_OnCast", AP + "GravitumLineAttack_cast"],
        "aphelios_W_gravitum": [AP + "WGravitum_swap"],
        "aphelios_infernum_auto": [AP + "InfernumAttack_OnCast"],
        "aphelios_infernum_line": [AP + "InfernumLineAttack_OnCast", AP + "InfernumLineAttack_cast"],
        "aphelios_W_infernum": [AP + "WInfernum_swap"],
        "aphelios_crescendum_auto": [AP + "CrescendumAttack_OnCast"],
        "aphelios_crescendum_line": [AP + "CrescendumLineAttack_OnCast", AP + "CrescendumLineAttack_cast"],
        "aphelios_W_crescendum": [AP + "WCrescendum_swap"],
        "aphelios_calibrum_hit": [AP + "CalibrumAttack_hit"],
        "aphelios_severum_hit": [AP + "SeverumAttack_hit"],
        "aphelios_gravitum_hit": [AP + "GravitumAttack_hit"],
        "aphelios_infernum_hit": [AP + "InfernumAttack_hit"],
        "aphelios_crit_hit": [AP + "CritAttack_hit"],
        "aphelios_crescendum_hit": [AP + "CrescendumAttackMisOut_OnHit"],
        "aphelios_crescendum_catch": [AP + "CrescendumAttackMisIn_OnHit"],
        "aphelios_chakram_out": [AP + "CrescendumAttackMisOutMini_launch"],
        "aphelios_chakram_catch": [AP + "CrescendumAttackMisInMini_OnHit"],
        "aphelios_mark_attack": [AP + "CalibrumAttackOverride_OnCast"],
        "aphelios_mark_hit": [AP + "CalibrumAttackMisChain_OnHit"],
        "aphelios_calibrum_Q": [AP + "CalibrumQ_cast"],
        "aphelios_calibrum_Q_hit": [AP + "CalibrumQ_OnHit"],
        "aphelios_severum_Q": [AP + "SeverumQ_OnCast"],
        "aphelios_gravitum_Q": [AP + "GravitumQ_cast"],
        "aphelios_gravitum_Q_beam": [AP + "GravitumQBeam_missilelaunch"],
        "aphelios_gravitum_root": [AP + "GravitumRoot_buffactivate"],
        "aphelios_infernum_Q": [AP + "InfernumQ_OnCast"],
        "aphelios_infernum_Q_burst": [AP + "InfernumQCastBurst_cast"],
        "aphelios_crescendum_Q": [AP + "CrescendumQ_OnCast"],
        "aphelios_crescendum_Q_land": [AP + "CrescendumQ_OnHitLocation"],
        "aphelios_sentry_calibrum": [AP + "CrescendumQCalibrum_buffactivate"],
        "aphelios_sentry_severum": [AP + "CrescendumQSeverum_buffactivate"],
        "aphelios_sentry_gravitum": [AP + "CrescendumQGravitum_buffactivate"],
        "aphelios_sentry_infernum": [AP + "CrescendumQInfernum_buffactivate"],
        "aphelios_sentry_end": [AP + "CrescendumQ_OnBuffDeactivate"],
        "aphelios_R": [AP + "R_OnCast"],
        "aphelios_R_launch": [AP + "RMis_OnMissileLaunch"],
        "aphelios_R_hit": [AP + "RMis_OnHit"],
        "aphelios_ammo": [AP + "PAmmoWarning_cast"],
        "aphelios_reload": [AP + "PAluneGun_cast", AP + "PAluneGunSelf_cast"],
        "aphelios_death": ["Play_sfx_Aphelios_Death3D_cast"],
    },
    SFX + "characters/aurelionsol/skins/base/aurelionsol_base_sfx": {
        "aurelionsol_auto": [AS + "Basicattack_cast"],
        "aurelionsol_crit": [AS + "Basicattack_cast"],
        "aurelionsol_auto_hit": [AS + "Basicattack_OnHitLocation"],
        "aurelionsol_crit_hit": [AS + "CritAttack_OnHit"],
        "aurelionsol_Q": [AS + "Q_OnCast"],
        "aurelionsol_Q_launch": [AS + "Q_missilelaunch"],
        "aurelionsol_Q_hit": [AS + "QDebuff_hit"],
        "aurelionsol_W": [AS + "W_OnCast"],
        "aurelionsol_W_off": [AS + "W_OnBuffDeactivate"],
        "aurelionsol_E": [AS + "E_OnCast"],
        "aurelionsol_E_end": [AS + "E_buffdeactivate"],
        "aurelionsol_R": [AS + "R2_OnCast"],
        "aurelionsol_R_launch": [AS + "R2Missile_missilelaunch_super"],
        "aurelionsol_R_hit": [AS + "R2Missile_hit_super"],
        "aurelionsol_death": ["Play_sfx_AurelionSol_Death3D_cast"],
    },
    SFX + "characters/sivir/skins/base/sivir_base_sfx": {
        "sivir_auto": [SV + "BasicAttack_OnCast"],
        "sivir_auto2": [SV + "BasicAttack2_OnCast"],
        "sivir_auto3": [SV + "BasicAttack3_OnCast"],
        "sivir_auto4": [SV + "BasicAttack4_OnCast"],
        "sivir_auto_launch": [SV + "BasicAttack_OnMissileLaunch"],
        "sivir_auto_hit": [SV + "BasicAttack_OnHit"],
        "sivir_crit": [SV + "CritAttack_OnCast"],
        "sivir_crit_launch": [SV + "CritAttack_OnMissileLaunch"],
        "sivir_crit_hit": [SV + "CritAttack_OnHit"],
        "sivir_Q": [SV + "Q_OnCast"],
        "sivir_Q_launch": [SV + "QMissile_OnMissileLaunch"],
        "sivir_Q_return": [SV + "QMissileReturn_OnMissileLaunch"],
        "sivir_Q_hit": [SV + "Q_hit"],
        "sivir_W": [SV + "W_OnCast"],
        "sivir_W_marker": [SV + "WMarker_OnBuffActivate"],
        "sivir_W_attack": [SV + "WAttack_OnCast"],
        "sivir_W_launch": [SV + "WAttack_OnMissileLaunch"],
        "sivir_W_bounce_hit": [SV + "WBounce_hit"],
        "sivir_E": [SV + "E_OnBuffActivate"],
        "sivir_E_off": [SV + "E_OnBuffDeactivate"],
        "sivir_R": [SV + "R_OnCast"],
        "sivir_R_on": [SV + "R_OnBuffActivate"],
        "sivir_R_off": [SV + "R_OnBuffDeactivate"],
        "sivir_passive_on": [SV + "PassiveSpeed_OnBuffActivate"],
        "sivir_passive_off": [SV + "PassiveSpeed_OnBuffDeactivate"],
        "sivir_death": ["Play_sfx_Sivir_Death3D_cast"],
    },
    SFX + "characters/gangplank/skins/base/gangplank_base_sfx": {
        "gangplank_auto": [GP + "BasicAttack_OnCast"],
        "gangplank_auto2": [GP + "BasicAttack_OnCast"],
        "gangplank_auto_hit": [GP + "BasicAttack_OnHit"],
        "gangplank_crit": [GP + "CritAttack_OnCast"],
        "gangplank_crit_hit": [GP + "CritAttack_OnHit"],
        "gangplank_P_auto": [GP + "PassiveAttack_OnBuffCast"],
        "gangplank_P_burn": [GP + "PassiveAttackDoT_OnBuffCast"],
        "gangplank_Q": [GP + "QProceed_OnCast"],
        "gangplank_Q_swing": [GP + "QProceed_Cast_Swing"],
        "gangplank_Q_point": [GP + "QProceed_Cast_Point"],
        "gangplank_Q_crit_swing": [GP + "QProceedCrit_Cast_Swing"],
        "gangplank_Q_launch": [GP + "QProceed_OnMissileLaunch"],
        "gangplank_Q_crit_launch": [GP + "QProceedCrit_OnMissileLaunch"],
        "gangplank_Q_hit": [GP + "QProceed_OnHit"],
        "gangplank_Q_crit_hit": [GP + "QProceedCrit_OnHit"],
        "gangplank_W": [GP + "W_OnCast"],
        "gangplank_W_foley": [GP + "W_foley"],
        "gangplank_W_cleanse": [GP + "WAudioCleanse_OnBuffCast"],
        "gangplank_E": [GP + "E_OnCast"],
        "gangplank_E_life": [GP + "EBarrelLife_OnBuffCast"],
        "gangplank_E_gone": [GP + "EBarrelLife_OnBuffDeactivate"],
        "gangplank_E_burn": [GP + "E_powderburn"],
        "gangplank_E_explode": [GP + "EBarrelExplosionSound_buffcast"],  # the bin's _OnBuffCast name is gone from the bank
        "gangplank_R": [GP + "R_OnCast"],
        "gangplank_R_shots": [GP + "R_distantshots"],
        "gangplank_R_hit": [GP + "R_bomb_hit"],
        "gangplank_R_bigshot": [GP + "R_bigshot"],
        "gangplank_R_speed": [GP + "RSpeed_OnBuffCast"],
        "gangplank_R_zone": [GP + "RZoneSpeed_buffactivate"],
        "gangplank_death": ["Play_sfx_Gangplank_Base_Death3D_buffactivate"],
    },
    SFX + "characters/orianna/skins/base/orianna_base_sfx": {
        "orianna_auto": [OR + "BasicAttack_OnCast"],
        "orianna_auto2": [OR + "BasicAttack2_OnCast"],
        "orianna_crit": [OR + "CritAttack_OnCast"],
        "orianna_auto_hit": [OR + "BasicAttack_OnHit"],
        "orianna_crit_hit": [OR + "CritAttack_OnHit"],
        "orianna_Q": ["Play_sfx_OrianaIzunaCommand_OnCast"],
        "orianna_Q_launch": ["Play_sfx_OrianaIzuna_OnMissileLaunch"],
        "orianna_Q_hit": [OR + "Izuna_hit"],
        "orianna_Q_land": [OR + "Izuna_buffdeactivate"],
        "orianna_W": ["Play_sfx_OrianaDissonanceCommand_OnCast"],
        "orianna_W_field": [OR + "DissonanceCommand_buffactivate"],
        "orianna_W_hit": [OR + "DissonanceCommand_hit"],
        "orianna_E": ["Play_sfx_OrianaRedactCommand_OnCast"],
        "orianna_E_launch": ["Play_sfx_OrianaRedact_OnMissileLaunch"],
        "orianna_E_shield": ["Play_sfx_OrianaRedactShield_OnBuffActivate"],
        "orianna_R": ["Play_sfx_OrianaDetonateCommand_OnCast"],
        "orianna_R_charge": [OR + "DetonateCommand_buffactivate"],
        "orianna_R_hit": [OR + "DetonateCommand_hit"],
        "orianna_ball_flash": [OR + "BallFlash_buffactivate"],
        "orianna_ball_attach": ["Play_sfx_OrianaGhostSelf_OnBuffActivate"],
        "orianna_death": ["Play_sfx_Orianna_Death3D_cast"],
    },
    SFX + "characters/twitch/skins/base/twitch_base_sfx": {
        "twitch_auto": [TW + "BasicAttack_OnCast"],
        "twitch_auto_launch": [TW + "BasicAttack_OnMissileLaunch", TW + "BasicAttack_OnMissileCast"],
        "twitch_auto_hit": [TW + "BasicAttack_OnHit"],
        "twitch_crit": [TW + "CritAttack_OnCast"],
        "twitch_crit_launch": [TW + "CritAttack_OnMissileCast"],
        "twitch_crit_hit": [TW + "CritAttack_OnHit"],
        "twitch_Q": [TW + "HideInShadows_OnCast"],
        "twitch_Q_on": [TW + "HideInShadows_OnBuffActivate"],
        "twitch_Q_off": [TW + "HideInShadows_OnBuffDeactivate"],
        "twitch_W": [TW + "VenomCask_OnCast"],
        "twitch_W_launch": [TW + "VenomCaskMissile_OnMissileLaunch"],
        "twitch_W_hit": [TW + "VenomCaskMissile_OnHitLocation"],
        "twitch_E": [TW + "Expunge_OnCast"],
        "twitch_E_launch": [TW + "Expunge_missilelaunch"],
        "twitch_E_hit": [TW + "Expunge_OnHit"],
        "twitch_R": [TW + "FullAutomatic_OnCast"],
        "twitch_R_on": [TW + "FullAutomatic_OnBuffActivate"],
        "twitch_R_off": [TW + "FullAutomatic_OnBuffDeactivate"],
        "twitch_R_attack": [TW + "SprayAndPrayAttack_OnCast"],
        "twitch_R_launch": [TW + "SprayAndPrayAttack_OnMissileCast", TW + "SprayAndPrayAttack_OnMissileLaunch"],
        "twitch_R_hit": [TW + "SprayAndPrayAttack_OnHit"],
        "twitch_death": ["Play_sfx_Twitch_Death3D_cast"],
    },
    SFX + "characters/lux/skins/base/lux_base_sfx": {
        "lux_auto": [LX + "BasicAttack_OnCast"],
        "lux_auto2": [LX + "BasicAttack2_OnCast"],
        "lux_crit": [LX + "CritAttack_OnCast"],
        "lux_auto_hit": [LX + "BasicAttack_OnHit"],
        "lux_crit_hit": [LX + "CritAttack_OnHit"],
        "lux_passive": [LX + "IlluminationPassive_hit"],
        "lux_Q": [LX + "LightBinding_OnCast"],
        "lux_Q_launch": [LX + "LightBindingDummy_OnMissileLaunch"],
        "lux_Q_hit": [LX + "LightBindingMis_OnBuffActivate", LX + "LightBinding_OnBuffActivate"],
        "lux_Q_end": [LX + "LightBindingMis_OnBuffDeactivate", LX + "LightBinding_OnBuffDeactivate"],
        "lux_W": [LX + "PrismaticWave_OnCast"],
        "lux_W_launch": [LX + "PrismaticWaveMissile_OnMissileLaunch"],
        "lux_W_shield": [LX + "PrismaticWaveShieldSelf_buffactivate", LX + "PrismaticWaveShield_buffactivate"],
        "lux_E": [LX + "LightStrikeKugel_OnCast"],
        "lux_E_launch": [LX + "LightStrikeKugel_OnMissileLaunch"],
        "lux_E_land": [LX + "LightStrikeKugel_buffactivate"],
        "lux_E_hit": [LX + "LightStrikeKugel_hit"],
        "lux_R": [LX + "R_OnCast"],
        "lux_R_beam": [LX + "RBeam_beammiddle"],
        "lux_R_end": [LX + "RBeam_beamend"],
        "lux_death": ["Play_sfx_Lux_Death3D_cast"],
    },
    SFX + "characters/ziggs/skins/base/ziggs_base_sfx": {
        "ziggs_auto": [ZG + "BasicAttack_OnCast"],
        "ziggs_auto2": [ZG + "BasicAttack2_OnCast"],
        "ziggs_crit": [ZG + "CritAttack_OnCast"],
        "ziggs_auto_hit": [ZG + "BasicAttack_OnHit", ZG + "BasicAttack2_OnHit"],
        "ziggs_crit_hit": [ZG + "CritAttack_OnHit"],
        "ziggs_P_ready": [ZG + "ShortFuse_OnBuffActivate"],
        "ziggs_P_auto": [ZG + "PassiveAttack_OnCast"],
        "ziggs_P_hit": [ZG + "PassiveAttack_OnHit"],
        "ziggs_Q": [ZG + "Q_OnCast"],
        "ziggs_Q_launch": [ZG + "QSpell_OnMissileLaunch"],
        "ziggs_Q_bounce": [ZG + "Q_hit_bounce"],
        "ziggs_Q_hit": [ZG + "Q_hit"],
        "ziggs_W": [ZG + "W_OnCast"],
        "ziggs_W_launch": [ZG + "W_OnMissileLaunch"],
        "ziggs_W_land": [ZG + "W_buffactivate"],
        "ziggs_W_hit": [ZG + "W_detonate"],
        "ziggs_E": [ZG + "E_OnCast"],
        "ziggs_E_launch": [ZG + "E2_OnMissileLaunch"],
        "ziggs_E_land": [ZG + "E2_OnBuffActivate"],
        "ziggs_E_hit": [ZG + "E_detonate"],
        "ziggs_R": [ZG + "R_OnCast"],
        "ziggs_R_launch": [ZG + "R_OnMissileLaunch", ZG + "R_missilelaunch"],
        "ziggs_R_fall": [ZG + "RImpactSound_OnBuffActivate"],
        "ziggs_R_hit": [ZG + "R_hit"],
        "ziggs_death": ["Play_sfx_Ziggs_Death3D_cast"],
    },
    SFX + "characters/teemo/skins/base/teemo_base_sfx": {
        "teemo_auto": [TE + "BasicAttack_OnCast"],
        "teemo_auto2": [TE + "BasicAttack_OnCast"],
        "teemo_crit": [TE + "CritAttack_OnCast"],
        "teemo_auto_hit": [TE + "BasicAttack_OnHit"],
        "teemo_crit_hit": [TE + "CritAttack_OnHit"],
        "teemo_E_auto": [TE + "EAttack_OnCast"],
        "teemo_E_crit": [TE + "ECrit_OnCast"],
        "teemo_E_hit": [TE + "EAttack_OnHit"],
        "teemo_E_crit_hit": [TE + "ECrit_OnHit"],
        "teemo_P": [TE + "PStealthBuff_buffactivate"],
        "teemo_P_end": [TE + "PStealthBuff_buffdeactivate"],
        "teemo_Q": [TE + "Q_OnCast"],
        "teemo_Q_launch": [TE + "Q_OnMissileLaunch"],
        "teemo_Q_hit": [TE + "Q_OnHit"],
        "teemo_W": [TE + "W_OnCast"],
        "teemo_W_end": [TE + "W_OnBuffDeactivate"],
        "teemo_R": [TE + "R_OnCast"],
        "teemo_R_launch": [TE + "R_missilelaunch"],
        "teemo_R_bounce": [TE + "RBounce_missilecast"],
        "teemo_R_arm": [TM + "buffactivate_arm"],
        "teemo_R_hit": [TM + "hitlocation"],
        "teemo_death": ["Play_sfx_Teemo_Death3D_cast"],
    },
    SHARED + "hud_global": {
        "hud_levelup": ["Play_sfx_hud_base_spell_levelup"],
        "hud_item": ["Play_sfx_hud_base_store_item_buy_basic"],
        "hud_legendary": ["Play_sfx_hud_base_store_item_buy_legendary"],
        "hud_open": ["Play_sfx_hud_base_options_open"],
        "hud_close": ["Play_sfx_hud_base_options_close"],
        "hud_click": ["Play_sfx_hud_base_generic_click"],
    },
    # no name known for the in-game music event: a switch container whose states are the music phases
    SHARED + "mus_map11": {"music": 3832820115},
}


def monster(bank, char, key, spawn=False):
    """Monster banks follow the LoL naming scheme: Play_sfx_<char>_<spell>_OnHit, Play_sfx_<char>_death_cast."""
    c = char
    sounds = {
        f"{key}_hit": [f"Play_sfx_{c}_{c}BasicAttack_OnHit", f"Play_sfx_{c}BasicAttack_OnHit", f"Play_sfx_{c}_BasicAttack_OnHit"],
        f"{key}_death": [f"Play_sfx_{c}_death_cast", f"Play_sfx_{c}_Death3D_cast", f"Play_sfx_{c}_death", f"Play_sfx_{c}_Death"],
    }
    if spawn:
        sounds[f"{key}_spawn"] = [f"Play_sfx_{c}_spawn_cast", f"Play_sfx_{c}_spawn", f"Play_sfx_{c}_Spawn"]
    BANKS.setdefault(SHARED + bank, {}).update(sounds)


# keys are the game's EnemyDef.model ids (src/data.ts)
monster("npc_global_minions_chaosmelee_sfx", "SRU_ChaosMinionMelee", "minion_melee")
monster("npc_global_minions_chaosrange_sfx", "SRU_ChaosMinionRanged", "minion_caster")
monster("npc_global_minions_chaossiege_sfx", "SRU_ChaosMinionSiege", "minion_siege")
monster("npc_global_minions_chaossuper_sfx", "SRU_ChaosMinionSuper", "minion_super")
monster("npc_map11_razorbeakmini_sfx", "SRU_RazorbeakMini", "razorbeak_mini")
monster("npc_map11_razorbeak_sfx", "SRU_Razorbeak", "razorbeak")
monster("npc_map11_murkwolf_sfx", "SRU_Murkwolf", "murkwolf")
monster("npc_map11_krug_sfx", "SRU_Krug", "krug")
monster("npc_map11_gromp_sfx", "SRU_Gromp", "gromp")
monster("npc_map11_blue_sfx", "SRU_Blue", "blue", spawn=True)
monster("npc_map11_red_sfx", "SRU_Red", "red", spawn=True)
monster("npc_map11_crab_sfx", "SRU_Crab", "scuttle", spawn=True)
monster("npc_map11_riftherald_sfx", "SRU_RiftHerald", "riftherald", spawn=True)
monster("npc_map11_baron_sfx", "SRU_Baron", "baron")
BA = "Play_sfx_SRU_Baron_"
BANKS[SHARED + "npc_map11_baron_sfx"].update({
    "baron_spawn": [BA + "spawn_cast_vox"],
    "baron_bite": [BA + "BaronAttackMelee_OnHit"],
    "baron_whip": [BA + "BaronTail_cast"],
    "baron_knockup": [BA + "BaronSpike_OnCast"],
    "baron_knockup_hit": [BA + "BaronSpike_OnHit"],
    "baron_tentacle": [BA + "NewSpellLivingArtillery_hit"],
    "baron_spit": [BA + "BaronAcidBall_Cast"],
    "baron_spit_launch": [BA + "BaronAcidBall_OnMissileLaunch"],
    "baron_pull": [BA + "BaronPullSpellMissile_cast"],
})
monster("npc_map11_dragons_sfx", "SRU_Dragon", "dragon", spawn=True)
for model, element in [("air", "Cloud"), ("fire", "Infernal"), ("earth", "Mountain"), ("water", "Ocean"), ("hextech", "Hextech"), ("chemtech", "Chemtech")]:
    BANKS.setdefault(SHARED + f"npc_map11_dragons_{element.lower()}_sfx", {})[f"dragon_{model}_hit"] = [
        f"Play_sfx_SRU_Dragon_{element}_Attack_OnHitLocation", f"Play_sfx_SRU_Dragon_{element}_Attack_OnHit"]


def fnv1(s):
    # Wwise ids: FNV-1 32 of the lowercase name
    h = 0x811C9DC5
    for c in s.lower().encode():
        h = ((h * 0x01000193) & 0xFFFFFFFF) ^ c
    return h


def unpack_wpk(data, out):
    # r3d2 wem pack: u32 count, offset table, entries of (u32 offset, u32 size, u32 name length, utf-16 name)
    (count,) = struct.unpack_from("<I", data, 8)
    for i in range(count):
        (o,) = struct.unpack_from("<I", data, 12 + 4 * i)
        off, size, nlen = struct.unpack_from("<III", data, o)
        (out / data[o + 12:o + 12 + nlen * 2].decode("utf-16le")).write_bytes(data[off:off + size])


def variants(txtp):
    """A single top-level random group ('group = -R3>1' picks take 1) becomes one txtp per take."""
    groups = re.findall(r"^group = -R(\d+)>1", txtp, re.M)
    if len(groups) != 1:
        return [txtp]
    n = min(int(groups[0]), MAX_VARIANTS)
    return [re.sub(r"^(group = -R\d+)>1", rf"\g<1>>{k}", txtp, flags=re.M) for k in range(1, n + 1)]


def render(txtp_path, mp3, music):
    wav = txtp_path.with_suffix(".wav")
    # -i: play once without looping (the game loops music itself)
    subprocess.run(["vgmstream-cli", "-i", "-o", str(wav), str(txtp_path)], check=True, capture_output=True)
    q = ["-b:a", "128k"] if music else ["-q:a", "5"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", *q, str(mp3)], check=True)
    wav.unlink()


def main(wwiser, out_dir, final_dir):
    final = Path(final_dir)
    wads = [Wad(final / w) for w in ("Champions/Ezreal.wad.client", "Champions/Samira.wad.client", "Champions/Brand.wad.client", "Champions/Aphelios.wad.client", "Champions/AurelionSol.wad.client", "Champions/Lux.wad.client", "Champions/Teemo.wad.client", "Champions/Ziggs.wad.client", "Champions/Sivir.wad.client", "Champions/Twitch.wad.client", "Champions/Orianna.wad.client", "Champions/Gangplank.wad.client", "Maps/Shipping/Map11.wad.client", "Maps/Shipping/Common.wad.client")]
    read = lambda p: next((d for d in (w.read(p) for w in wads) if d is not None), None)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        for bank, wanted in BANKS.items():
            work = Path(tmp) / Path(bank).name
            work.mkdir()
            for suffix in ("_events.bnk", "_audio.bnk", "_audio.wpk"):
                data = read(bank + suffix)
                if data is None:
                    continue
                if suffix.endswith(".wpk"):
                    unpack_wpk(data, work)
                else:
                    (work / Path(bank + suffix).name).write_bytes(data)
            banks = sorted(str(p) for p in work.glob("*.bnk"))
            if not banks:
                print(f"missing bank {bank}")
                continue
            subprocess.run([sys.executable, wwiser, "-g", "-gd", *banks], cwd=work, check=True, capture_output=True)
            txtps = [(p, p.read_text(errors="replace")) for p in sorted((work / "txtp").glob("*.txtp"))]
            for key, names in wanted.items():
                ids = [names] if isinstance(names, int) else [fnv1(n) for n in names]
                found = []
                for eid in ids:
                    found = [t for _, t in txtps if re.search(rf"CAkEvent\[\d+\] {eid}\b", t)]
                    if found:
                        break
                if not found:
                    print(f"{key}: no event in {Path(bank).name}")
                    continue
                # -gd also writes txtp that only differ in their comments (same event reached by several paths)
                unique = {re.sub(r"^#.*$", "", t, flags=re.M).strip(): t for t in found}
                takes = [v for t in unique.values() for v in variants(t)][: 8 if key == "music" else MAX_VARIANTS]
                files = []
                for i, t in enumerate(takes):
                    p = work / "txtp" / f"_{key}_{i}.txtp"  # txtp paths to the wems are relative to txtp/
                    p.write_text(t)
                    name = f"{key}_{i}.mp3"
                    render(p, out / name, key == "music")
                    files.append(name)
                manifest[key] = files
                print(f"{key}: {len(files)}")
            shutil.rmtree(work)
    (out / "sounds.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
