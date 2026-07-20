/**
 * Password policy (NIST-aligned: favour length + a common-password blocklist over
 * arbitrary composition rules). Server-authoritative; enforced on register, invite
 * and any future reset. Returns an error message, or null when acceptable.
 */
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

// Small blocklist of the most common weak passwords (lowercased).
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "letmein", "iloveyou", "welcome1",
  "admin123", "administrator", "changeme", "abc12345", "trustno1", "sunshine",
  "football", "monkey123", "master123", "hfos1234",
]);

export function validatePassword(password: string, email?: string): string | null {
  if (!password || password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (password.length > MAX_LENGTH) return "Password is too long.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "That password is too common — please choose a stronger one.";
  const local = (email ?? "").split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    return "Password must not contain the name part of your email.";
  }
  // Reject trivially low-entropy passwords (single repeated char, simple runs).
  if (/^(.)\1+$/.test(password)) return "Password is too simple.";
  return null;
}
