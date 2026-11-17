import { isUserFeatureOn, type UserFeature } from '@/config/user-features';
import { getAllConfigs } from '@/modules/config/service';

/** Server check for a user-center feature switch (see config/user-features). */
export async function userFeatureEnabled(feature: UserFeature) {
  return isUserFeatureOn(await getAllConfigs(), feature);
}
