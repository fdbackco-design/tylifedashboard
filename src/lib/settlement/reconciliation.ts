import type { HeadquartersSettlementExcelRow } from './reconciliation-excel';

export type ReconciliationReason =
  | '본사 정산됨 / 시스템 정산 누락'
  | '시스템 정산됨 / 본사 미정산'
  | '본사 환수 계약'
  | '담당자 매칭 차이'
  | '금액 차이'
  | '정상';

export type ReconciliationPayoutType = '개인수당' | '롤업수당' | '케어플랜수당' | '환수금';

export type ReconciliationSystemLine = {
  contractCode: string;
  contractId: string | null;
  recipientMemberId: string;
  recipientName: string;
  effectiveOwnerName: string;
  amount: number;
  payoutType: ReconciliationPayoutType;
  unitCount: number;
  organizationPath?: string | null;
  upperRank?: string | null;
  lowerRank?: string | null;
  upperUnitPrice?: number | null;
  lowerUnitPrice?: number | null;
  rollupUnitPrice?: number | null;
};

export type ReconciliationContractMeta = {
  contractCode: string;
  contractId: string | null;
  customerName: string;
  productName: string;
  ownerMemberId: string | null;
  ownerName: string;
};

export type ReconciliationDetailRow = {
  id: string;
  memberId: string | null;
  memberName: string;
  contractCode: string;
  customerName: string;
  productName: string;
  excelOwner: string;
  effectiveOwnerName: string;
  excelPresent: boolean;
  headquartersAmount: number | null;
  systemAmount: number;
  expectedAmount: number | null;
  payoutType: ReconciliationPayoutType | '미산출' | '미정산';
  reason: ReconciliationReason;
  unitCount: number;
  organizationPath: string | null;
  upperRank: string | null;
  lowerRank: string | null;
  upperUnitPrice: number | null;
  lowerUnitPrice: number | null;
  rollupUnitPrice: number | null;
};

export type ReconciliationMemberRow = {
  memberId: string;
  memberName: string;
  currentAmount: number;
  expectedAmount: number;
  difference: number;
  unresolvedCount: number;
  detailRows: ReconciliationDetailRow[];
};

export type ReconciliationResult = {
  summary: {
    headquartersContractCount: number;
    systemContractCount: number;
    matchedContractCount: number;
    mismatchedContractCount: number;
    differentMemberCount: number;
  };
  members: ReconciliationMemberRow[];
  unmatchedDetails: ReconciliationDetailRow[];
};

function comparableName(value: string): string {
  return value.replace(/^\[고객\]\s*/, '').replace(/\s+/g, '').trim().toLowerCase();
}

function isExcelApplicableToLine(
  excel: HeadquartersSettlementExcelRow,
  line: ReconciliationSystemLine,
): boolean {
  if (line.amount < 0) return excel.headquartersAmount < 0;
  return excel.headquartersAmount > 0;
}

function resolveReason(
  excel: HeadquartersSettlementExcelRow | undefined,
  line: ReconciliationSystemLine,
  expectedAmount: number,
  effectiveOwnerName: string,
): ReconciliationReason {
  if (excel?.headquartersAmount != null && excel.headquartersAmount < 0) {
    return '본사 환수 계약';
  }
  if (!excel || excel.headquartersAmount === 0) {
    return '시스템 정산됨 / 본사 미정산';
  }
  if (!isExcelApplicableToLine(excel, line)) return '금액 차이';
  if (
    excel.excelOwner &&
    effectiveOwnerName &&
    comparableName(excel.excelOwner) !== comparableName(effectiveOwnerName)
  ) {
    return '담당자 매칭 차이';
  }
  if (line.amount !== expectedAmount) return '금액 차이';
  return '정상';
}

export function reconcileHeadquartersSettlements(args: {
  excelRows: HeadquartersSettlementExcelRow[];
  systemLines: ReconciliationSystemLine[];
  contractMetaByCode: Map<string, ReconciliationContractMeta>;
}): ReconciliationResult {
  const excelByCode = new Map(args.excelRows.map((row) => [row.contractCode, row]));
  const systemCodes = new Set(args.systemLines.map((line) => line.contractCode));
  const details: ReconciliationDetailRow[] = [];

  args.systemLines.forEach((line, index) => {
    const excel = excelByCode.get(line.contractCode);
    const meta = args.contractMetaByCode.get(line.contractCode);
    const expectedAmount = excel && isExcelApplicableToLine(excel, line) ? line.amount : 0;
    const effectiveOwnerName = line.effectiveOwnerName || meta?.ownerName || '';
    details.push({
      id: `system:${index}:${line.contractCode}:${line.recipientMemberId}:${line.payoutType}`,
      memberId: line.recipientMemberId,
      memberName: line.recipientName,
      contractCode: line.contractCode,
      customerName: excel?.customerName || meta?.customerName || '',
      productName: excel?.productName || meta?.productName || '',
      excelOwner: excel?.excelOwner ?? '',
      effectiveOwnerName,
      excelPresent: Boolean(excel),
      headquartersAmount: excel?.headquartersAmount ?? null,
      systemAmount: line.amount,
      expectedAmount,
      payoutType: line.payoutType,
      reason: resolveReason(excel, line, expectedAmount, effectiveOwnerName),
      unitCount: line.unitCount,
      organizationPath: line.organizationPath ?? null,
      upperRank: line.upperRank ?? null,
      lowerRank: line.lowerRank ?? null,
      upperUnitPrice: line.upperUnitPrice ?? null,
      lowerUnitPrice: line.lowerUnitPrice ?? null,
      rollupUnitPrice: line.rollupUnitPrice ?? null,
    });
  });

  for (const excel of args.excelRows) {
    if (systemCodes.has(excel.contractCode)) continue;
    const meta = args.contractMetaByCode.get(excel.contractCode);
    const memberId = meta?.ownerMemberId ?? null;
    const memberName = meta?.ownerName || excel.excelOwner || '담당자 미매칭';
    const isUnsettled = excel.headquartersAmount === 0;
    details.push({
      id: `excel-only:${excel.contractCode}`,
      memberId,
      memberName,
      contractCode: excel.contractCode,
      customerName: excel.customerName || meta?.customerName || '',
      productName: excel.productName || meta?.productName || '',
      excelOwner: excel.excelOwner,
      effectiveOwnerName: meta?.ownerName ?? '',
      excelPresent: true,
      headquartersAmount: excel.headquartersAmount,
      systemAmount: 0,
      expectedAmount: isUnsettled ? 0 : null,
      payoutType: isUnsettled ? '미정산' : '미산출',
      reason:
        excel.headquartersAmount < 0
          ? '본사 환수 계약'
          : isUnsettled
            ? '정상'
            : '본사 정산됨 / 시스템 정산 누락',
      unitCount: 0,
      organizationPath: null,
      upperRank: null,
      lowerRank: null,
      upperUnitPrice: null,
      lowerUnitPrice: null,
      rollupUnitPrice: null,
    });
  }

  const memberMap = new Map<string, ReconciliationMemberRow>();
  const unmatchedDetails: ReconciliationDetailRow[] = [];
  for (const detail of details) {
    if (!detail.memberId) {
      unmatchedDetails.push(detail);
      continue;
    }
    const row = memberMap.get(detail.memberId) ?? {
      memberId: detail.memberId,
      memberName: detail.memberName,
      currentAmount: 0,
      expectedAmount: 0,
      difference: 0,
      unresolvedCount: 0,
      detailRows: [],
    };
    row.currentAmount += detail.systemAmount;
    if (detail.expectedAmount == null) row.unresolvedCount++;
    else row.expectedAmount += detail.expectedAmount;
    row.detailRows.push(detail);
    memberMap.set(detail.memberId, row);
  }

  const members = [...memberMap.values()]
    .map((row) => ({
      ...row,
      difference: row.expectedAmount - row.currentAmount,
      detailRows: row.detailRows.sort((a, b) => a.contractCode.localeCompare(b.contractCode)),
    }))
    .sort((a, b) => {
      const aDiff = Math.abs(a.difference) + (a.unresolvedCount > 0 ? Number.MAX_SAFE_INTEGER : 0);
      const bDiff = Math.abs(b.difference) + (b.unresolvedCount > 0 ? Number.MAX_SAFE_INTEGER : 0);
      return bDiff - aDiff || a.memberName.localeCompare(b.memberName, 'ko-KR');
    });

  const allCodes = new Set([...excelByCode.keys(), ...systemCodes]);
  const mismatchCodes = new Set(
    details.filter((row) => row.reason !== '정상').map((row) => row.contractCode),
  );
  const matchedContractCount = [...allCodes].filter((code) => !mismatchCodes.has(code)).length;
  return {
    summary: {
      headquartersContractCount: excelByCode.size,
      systemContractCount: systemCodes.size,
      matchedContractCount,
      mismatchedContractCount: allCodes.size - matchedContractCount,
      differentMemberCount:
        members.filter(
          (row) => row.difference !== 0 || row.unresolvedCount > 0,
        ).length + (unmatchedDetails.length > 0 ? 1 : 0),
    },
    members,
    unmatchedDetails,
  };
}
