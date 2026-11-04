import { snapshotBody as snapshotContract } from '@studious/api';

export {
  householdBody,
  memberBody,
  accountBody,
  accountUpdateBody,
  householdParams,
  accountParams,
  historyQuery,
} from '@studious/api';

export const snapshotBody = snapshotContract.transform((value) => ({
  ...value,
  asOf: new Date(value.asOf),
}));
