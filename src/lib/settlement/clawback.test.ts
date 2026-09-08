import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  netPayoutAfterClawback,
  resolveClawbackWon,
  resolveManualAdjustmentWon,
} from './manual-adjustment';

const JO_YI_CHAN_MEMBER_ID = '40605438-9fc8-4dac-acda-f8b37c3add5b';

describe('resolveClawbackWon', () => {
  it('DB 값이 있으면 그 금액을 쓴다', () => {
    assert.equal(resolveClawbackWon('any', '2026-08', 150_000), 150_000);
    assert.equal(resolveClawbackWon(JO_YI_CHAN_MEMBER_ID, '2026-07', 0), 0);
  });

  it('DB 미입력이면 코드 고정 예외 환수를 쓴다', () => {
    assert.equal(resolveClawbackWon(JO_YI_CHAN_MEMBER_ID, '2026-07', null), 600_000);
    assert.equal(resolveClawbackWon(JO_YI_CHAN_MEMBER_ID, '2026-08', null), 0);
  });
});

describe('resolveManualAdjustmentWon', () => {
  it('환수금은 합계에서 빼는 음수 가감이다', () => {
    const adj = resolveManualAdjustmentWon('m1', '2026-08', 250_000);
    assert.equal(adj?.amount_won, -250_000);
  });
});

describe('netPayoutAfterClawback', () => {
  it('개인+오버라이드+보너스에서 환수금을 뺀다', () => {
    assert.equal(netPayoutAfterClawback(1_000_000, 200_000, 50_000, 150_000), 1_100_000);
  });

  it('수당 0원에 환수만 있으면 합계는 음수다', () => {
    assert.equal(netPayoutAfterClawback(0, 0, 0, 300_000), -300_000);
  });
});
