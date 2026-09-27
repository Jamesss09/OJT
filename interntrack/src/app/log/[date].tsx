import { useLocalSearchParams } from 'expo-router';

import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

/**
 * Add/edit a single day. Reached from History (T-31) or a deep link.
 *
 * The real screen is T-25. It renders the raw `date` param here purely to prove
 * the dynamic segment resolves — validation of that param is T-25's job
 * (R-3: must be a real, non-future YYYY-MM-DD).
 */
export default function LogDayScreen() {
  const { date } = useLocalSearchParams<{ date: string | string[] }>();

  return (
    <ScreenPlaceholder
      title="Edit day"
      task="T-25"
      detail={`route param date = ${Array.isArray(date) ? date.join(',') : date}`}
    />
  );
}
