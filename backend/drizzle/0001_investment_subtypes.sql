-- Hand-written: drizzle-kit emits a table rebuild with PRAGMA foreign_keys=OFF, which cannot run
-- inside the transactional migration runner while other tables reference accounts.
ALTER TABLE `accounts` ADD COLUMN `subtype` text CONSTRAINT "accounts_subtype_valid" CHECK("subtype" IS NULL OR ("type" = 'INVESTMENT' AND "subtype" IN ('TFSA', 'RRSP', 'SPOUSAL_RRSP', 'GROUP_RRSP', 'FHSA', 'RESP', 'RDSP', 'RRIF', 'LIRA', 'LIF', 'DCPP', 'DBPP', 'DPSP', 'NON_REGISTERED')));
