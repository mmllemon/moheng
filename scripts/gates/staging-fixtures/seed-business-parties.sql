-- Stage 4: insert formal party records AFTER the BusinessParty migration has created
-- conservative legacy rows from free-text snapshots. This intentionally leaves same-name
-- formal/legacy duplicates for reviewer decision instead of silently merging legal identities.
\set ON_ERROR_STOP on
SET search_path TO moheng_staging_test;

INSERT INTO "BusinessParty"
  ("id", "name", "normalizedName", "creditCode", "legalRepresentative", "roles", "status", "identityVerified", "address", "formerNames", "createdAt", "updatedAt")
VALUES
  ('stg-party-01', '华东建设集团股份有限公司', '华东建设集团股份有限公司', '91310100MA1K234X56', '陈华东', '{OWNER,OTHER}', 'ACTIVE', true, '上海市浦东新区世纪大道100号', '{}', NOW() - interval '500 days', NOW() - interval '30 days'),
  ('stg-party-02', '华东建设集团股份有限责任公司', '华东建设集团股份有限责任公司', '91310100MA1K999Y88', '陈华栋', '{OTHER}', 'ACTIVE', true, '上海市浦东新区世纪大道188号', '{}', NOW() - interval '400 days', NOW() - interval '30 days'),
  ('stg-party-03', '西部数据科技有限公司', '西部数据科技有限公司', '91510100MA6L456Z12', '周西部', '{OWNER}', 'ACTIVE', true, '成都市高新区天府大道200号', '{西部数据科技有限责任公司}', NOW() - interval '450 days', NOW() - interval '20 days'),
  ('stg-party-04', '西部数据服务有限公司', '西部数据服务有限公司', '91510100MA6L777Q34', '周西东', '{SERVICE_PROVIDER}', 'ACTIVE', true, '成都市高新区天府大道266号', '{}', NOW() - interval '300 days', NOW() - interval '20 days'),
  ('stg-party-05', '市政工程建设管理处', '市政工程建设管理处', '11500000MB0U5678W9', '李市政', '{OWNER}', 'ACTIVE', true, '重庆市渝中区人民路123号', '{市政工程管理处}', NOW() - interval '200 days', NOW() - interval '10 days');
