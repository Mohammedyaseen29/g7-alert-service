import { z } from 'zod';

export const NotificationConfigSchema = z.object({
  emails: z.array(z.string().trim().email().max(254)).max(25),
}).transform(({ emails }) => {
  const seen = new Set<string>();
  return {
    emails: emails.filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
});
