/**
 * 팀장 검증(2026-09) 기준: 확정 지급 배분 시드 + 8월 환수 SSOT.
 */
import type { ConfirmedPayoutLine } from '@/lib/settlement/confirmed-payout-ledger';

export const MEMBER_IDS = {
  임태순: '3dc6163e-5861-47fb-931f-76fd5a4ec8bf',
  이지현: '9beafd30-f51f-4068-a4a3-57a924fbaaa0',
  정철희: '55afe568-699e-4c76-8545-4208718fce4b',
  박미선_리더: 'a7bc77cb-fda1-4d7d-b28d-4cd9f22763c0',
  김중권: '18b313f4-21be-4cb9-af1e-1dcfdda84e84',
  조명희: 'bcfc9261-3cc9-48e0-b45f-2b560c2b0375',
  황새로미: 'e3ddf6d7-fd66-468b-896c-ef13b4aba91d',
} as const;

function L(
  p: Omit<ConfirmedPayoutLine, 'contract_id' | 'frozen' | 'note'> & {
    note: string;
  },
): ConfirmedPayoutLine {
  return { contract_id: null, frozen: true, ...p };
}

export const CONFIRMED_PAYOUT_SEED_LINES: ConfirmedPayoutLine[] = [
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23620260727',
    recipient_member_id: MEMBER_IDS.정철희,
    amount_type: 'personal',
    amount_won: 300_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23720260727',
    recipient_member_id: MEMBER_IDS.정철희,
    amount_type: 'personal',
    amount_won: 300_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23620260727',
    recipient_member_id: MEMBER_IDS.박미선_리더,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23720260727',
    recipient_member_id: MEMBER_IDS.박미선_리더,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23620260727',
    recipient_member_id: MEMBER_IDS.임태순,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY23720260727',
    recipient_member_id: MEMBER_IDS.임태순,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(홍진운)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY27720260724',
    recipient_member_id: MEMBER_IDS.이지현,
    amount_type: 'personal',
    amount_won: 400_000,
    unit_count: 1,
    note: '7월 확정(고객 임태순)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY27820260724',
    recipient_member_id: MEMBER_IDS.이지현,
    amount_type: 'personal',
    amount_won: 400_000,
    unit_count: 1,
    note: '7월 확정(고객 임태순)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY27720260724',
    recipient_member_id: MEMBER_IDS.임태순,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(고객 임태순)',
  }),
  L({
    source_year_month: '2026-07',
    contract_code: 'TY27820260724',
    recipient_member_id: MEMBER_IDS.임태순,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '7월 확정(고객 임태순)',
  }),
  L({
    source_year_month: '2026-06',
    contract_code: 'TY00220260608',
    recipient_member_id: MEMBER_IDS.김중권,
    amount_type: 'personal',
    amount_won: 300_000,
    unit_count: 1,
    note: '6월 확정(최가희)',
  }),
  L({
    source_year_month: '2026-06',
    contract_code: 'TY00320260608',
    recipient_member_id: MEMBER_IDS.김중권,
    amount_type: 'personal',
    amount_won: 300_000,
    unit_count: 1,
    note: '6월 확정(최가희)',
  }),
  L({
    source_year_month: '2026-06',
    contract_code: 'TY00220260608',
    recipient_member_id: MEMBER_IDS.조명희,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '6월 확정(최가희)',
  }),
  L({
    source_year_month: '2026-06',
    contract_code: 'TY00320260608',
    recipient_member_id: MEMBER_IDS.조명희,
    amount_type: 'rollup',
    amount_won: 100_000,
    unit_count: 1,
    note: '6월 확정(최가희)',
  }),
];

export const AUGUST_2026_CLAWBACK_BY_MEMBER_ID: ReadonlyMap<string, number> = new Map([
  [MEMBER_IDS.정철희, 600_000],
  [MEMBER_IDS.박미선_리더, 200_000],
  [MEMBER_IDS.임태순, 400_000],
  [MEMBER_IDS.이지현, 800_000],
  [MEMBER_IDS.김중권, 600_000],
  [MEMBER_IDS.조명희, 200_000],
]);

export const AUGUST_2026_CLAWBACK_CLEAR_MEMBER_IDS: readonly string[] = [MEMBER_IDS.황새로미];
