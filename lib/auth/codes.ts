import { randomInt } from "node:crypto";

/**
 * Access code generation, shared by the admin scripts.
 *
 * 12 characters from a 31-symbol alphabet without look-alikes (no 0/O, 1/I/L): about
 * 59 bits of entropy from a CSPRNG. Displayed as XXXX XXXX XXXX; sign-in ignores spaces
 * and case (see normalizeAccessCode in ./access-code).
 */

export const ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ACCESS_CODE_LENGTH = 12;

export function generateAccessCode(): string {
  let code = "";
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) code += ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)];
  return code;
}

/** "74J8PKF667DB" -> "74J8 PKF6 67DB" */
export function formatAccessCode(code: string): string {
  return code.match(/.{1,4}/g)!.join(" ");
}
