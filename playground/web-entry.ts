/**
 * Copyright 2026 Kapil — Project Panini Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser entry point for the playground. Bundles every grammar JSON,
 * category table and entity dictionary, injects them (no filesystem in
 * the browser), and exposes a single `paniniParse` on window.
 */

import type { GrammarRuleSet, InputSource } from '@panini/core';
import { parseBankNarration, setDictionaries } from '@panini/rules-engine';

import archetypes from '../packages/rules-engine/rules/archetypes.json';
import axis from '../packages/rules-engine/rules/axis.json';
import bob from '../packages/rules-engine/rules/bob.json';
import canara from '../packages/rules-engine/rules/canara.json';
import categories from '../packages/rules-engine/rules/categories.json';
import federal from '../packages/rules-engine/rules/federal.json';
import generic from '../packages/rules-engine/rules/generic.json';
import hdfc from '../packages/rules-engine/rules/hdfc.json';
import icici from '../packages/rules-engine/rules/icici.json';
import idfc from '../packages/rules-engine/rules/idfc.json';
import indusind from '../packages/rules-engine/rules/indusind.json';
import kotak from '../packages/rules-engine/rules/kotak.json';
import pnb from '../packages/rules-engine/rules/pnb.json';
import rbl from '../packages/rules-engine/rules/rbl.json';
import sbi from '../packages/rules-engine/rules/sbi.json';
import union from '../packages/rules-engine/rules/union.json';
import wallet from '../packages/rules-engine/rules/wallet.json';
import yes from '../packages/rules-engine/rules/yes.json';

import merchantsJson from '../packages/rules-engine/rules/entities/merchants.json';
import vpaJson from '../packages/rules-engine/rules/entities/vpa-handles.json';
import ifscJson from '../packages/rules-engine/rules/entities/ifsc-codes.json';

const RULE_SETS: readonly GrammarRuleSet[] = [
  archetypes,
  axis,
  bob,
  canara,
  federal,
  generic,
  hdfc,
  icici,
  idfc,
  indusind,
  kotak,
  pnb,
  rbl,
  sbi,
  union,
  wallet,
  yes,
] as unknown as GrammarRuleSet[];

setDictionaries({
  merchants: merchantsJson.merchants,
  vpaHandles: vpaJson.handles,
  ifscBanks: ifscJson.banks,
});

export interface PaniniWindow {
  paniniParse: (text: string, bankHint?: string, source?: InputSource) => unknown;
}

(window as unknown as PaniniWindow).paniniParse = (text, bankHint, source) =>
  parseBankNarration(
    {
      text,
      ...(bankHint !== undefined && bankHint.length > 0 ? { bankHint } : {}),
      ...(source !== undefined ? { source } : {}),
    },
    { bare: true, ruleSets: RULE_SETS, categories },
  );
