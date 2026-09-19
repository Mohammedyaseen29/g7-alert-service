import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names while letting Tailwind utilities resolve predictably. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
