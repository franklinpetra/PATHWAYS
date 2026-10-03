/**
 * The public bodies behind each Washington connector. The URL and dates are not
 * defaulted: whoever loads a file states where it came from and when it was current.
 */

export interface SourceDefinition {
  sourceName: string;
  verificationAuthority: string;
}

export const SOURCES = {
  arts: {
    sourceName: "Apprenticeship Registration and Tracking System (ARTS)",
    verificationAuthority: "Washington State Department of Labor & Industries",
  },
  career_bridge: {
    sourceName: "Career Bridge",
    verificationAuthority: "Washington Workforce Training and Education Coordinating Board",
  },
  sbctc: {
    sourceName: "SBCTC program data",
    verificationAuthority: "Washington State Board for Community and Technical Colleges",
  },
  onet: {
    sourceName: "O*NET OnLine",
    verificationAuthority: "U.S. Department of Labor, Employment and Training Administration",
  },
  esd_oews: {
    sourceName: "Occupational Employment and Wage Estimates (OEWS)",
    verificationAuthority: "Washington State Employment Security Department",
  },
} as const satisfies Record<string, SourceDefinition>;

export type SourceKey = keyof typeof SOURCES;

/** Attribution stamped on every row a connector produces. */
export interface SourceStamp {
  source_name: string;
  verification_authority: string;
  source_url: string;
  source_as_of: string;
  observation_period: string | null;
}

export function makeStamp(
  key: SourceKey,
  args: { sourceUrl: string; asOf: string; observationPeriod?: string | null; today?: string },
): SourceStamp {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf) || Number.isNaN(Date.parse(args.asOf))) {
    throw new Error(`as-of date "${args.asOf}" must be YYYY-MM-DD`);
  }
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  if (args.asOf > today) throw new Error(`as-of date ${args.asOf} is in the future`);
  const url = new URL(args.sourceUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("source URL must be http(s)");
  return {
    source_name: SOURCES[key].sourceName,
    verification_authority: SOURCES[key].verificationAuthority,
    source_url: url.toString(),
    source_as_of: args.asOf,
    observation_period: args.observationPeriod?.trim() || null,
  };
}
