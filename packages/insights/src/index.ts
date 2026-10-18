/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export { analyzeTransactions, RULE_IDS } from './analyze';
export { evaluateScorecard, validateScorecardSpec, ScorecardSpecError } from './scorecard';
export { detectMonitoringEvents, runMonitorCycle, statementDiff } from './monitor';
export type {
  AlertSink,
  MonitorCycleOptions,
  MonitorCycleResult,
  MonitorEventSeverity,
  MonitoringEvent,
  MonitorRules,
  MonitorSnapshot,
  SnapshotStore,
  StatementDiff,
  StatementSource,
} from './monitor';
export type {
  ScorecardBand,
  ScorecardCondition,
  ScorecardComposite,
  ScorecardContribution,
  ScorecardOp,
  ScorecardResult,
  ScorecardRule,
  ScorecardSpec,
  ScorecardWhen,
} from './scorecard';
export type {
  CashflowSummary,
  Evidence,
  FoirSummary,
  IncomeEvent,
  IncomeSummary,
  InsightsOptions,
  InsightsReport,
  InsightTransaction,
  ObligationsSummary,
  RecurringObligation,
  RiskSignal,
  RuleId,
  SignalSeverity,
} from './types';
