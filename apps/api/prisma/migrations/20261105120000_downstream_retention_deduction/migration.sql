-- 质保金专项扣回：允许在最终结算之后，从留置余额里扣减缺陷维修、第三方代修等费用。
-- 扣回不生成应付；负数扣回是同一条动作的红字冲回，因此类型只需要一个新值。
ALTER TYPE "DownstreamRetentionMovementType" ADD VALUE IF NOT EXISTS 'DEDUCT';
