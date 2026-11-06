-- 专项扣回的红字冲回需要允许负数金额，但只对 DEDUCT 开放。
-- 原约束是 CHECK ("amount" > 0)，对留置、释放、没收继续强制正数，避免误录负数把余额抬高。
ALTER TABLE "DownstreamRetentionMovement" DROP CONSTRAINT "DownstreamRetentionMovement_amount_positive";
ALTER TABLE "DownstreamRetentionMovement" ADD CONSTRAINT "DownstreamRetentionMovement_amount_signed"
  CHECK ("amount" > 0 OR ("type" = 'DEDUCT' AND "amount" < 0));
