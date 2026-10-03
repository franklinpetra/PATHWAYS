import type { OccupationWage } from "@/lib/db/types";
import type { SourceAttribution } from "@/lib/workspace/events";

/**
 * Income math, done in code so every figure the reply states is computed and sourced,
 * never estimated by the model.
 *
 *  - An income target from the person's own housing cost, using HUD's cost-burden line:
 *    households paying more than 30% of income for housing are cost burdened.
 *  - Washington wages for an occupation, annualized the way ESD does (hourly x 2,080),
 *    and compared with that target.
 *  - When no occupation's median reaches the target, the remaining gap per year and month,
 *    and the side-work hours at the best occupation's median wage that would close it.
 *  - Washington's pay transparency law, quoted from the statute, so postings can be
 *    compared by their required pay ranges.
 */

/** HUD: cost-burdened households pay more than 30 percent of their income for housing. */
export const HUD_COST_BURDEN_SHARE = 0.3;

/** ESD annualizes hourly wages at full time: "multiplying the hourly rate by 2,080 hours". */
export const FULL_TIME_HOURS = 2080;

export const HUD_COST_BURDEN_SOURCE: Omit<SourceAttribution, "asOf"> = {
  name: "Rental Burdens: Rethinking Affordability Measures (PD&R Edge)",
  observationPeriod: null,
  verificationAuthority: "U.S. Department of Housing and Urban Development",
  url: "https://www.huduser.gov/portal/pdredge/pdr_edge_featd_article_092214.html",
};

/** When the HUD definition above was last checked against the source. */
export const HUD_COST_BURDEN_CHECKED = "2026-10-02";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const people = new Intl.NumberFormat("en-US");

export interface IncomeTarget {
  monthlyHousing: number;
  annual: number;
}

export interface IncomeClaim {
  id: string;
  kind: "income" | "wage";
  statement: string;
  source: SourceAttribution;
}

/** The gross income at which this housing cost is exactly 30% of income. */
export function incomeTarget(monthlyHousing: number | null): IncomeTarget | null {
  if (monthlyHousing == null || !Number.isFinite(monthlyHousing) || monthlyHousing <= 0) return null;
  return { monthlyHousing, annual: Math.ceil((monthlyHousing * 12) / HUD_COST_BURDEN_SHARE) };
}

export function incomeTargetClaim(target: IncomeTarget): IncomeClaim {
  const monthly = Math.ceil(target.annual / 12);
  const hourly = target.annual / FULL_TIME_HOURS;
  return {
    id: "income:housing-target",
    kind: "income",
    statement:
      `HUD counts a household as cost burdened when housing takes more than 30% of income. ` +
      `At a housing cost of ${dollars.format(target.monthlyHousing)}/month, staying within 30% takes a gross household income of at least ` +
      `${dollars.format(target.annual)}/year (${dollars.format(monthly)}/month, or ${cents.format(hourly)}/hour at ${people.format(FULL_TIME_HOURS)} full-time hours).`,
    source: { ...HUD_COST_BURDEN_SOURCE, asOf: HUD_COST_BURDEN_CHECKED },
  };
}

const annualize = (hourly: number) => Math.round(hourly * FULL_TIME_HOURS);

/**
 * When even the best-paying occupation found has a median below the target: the gap, and how
 * many hours a month of paid side work at that occupation's median wage would close it.
 */
export function incomeGapClaim(target: IncomeTarget, wages: OccupationWage[]): IncomeClaim | null {
  const withMedian = wages.filter((w) => w.median_hourly != null);
  if (withMedian.length === 0) return null;
  const best = withMedian.reduce((a, b) => (Number(b.median_hourly) > Number(a.median_hourly) ? b : a));
  const hourly = Number(best.median_hourly);
  const annual = annualize(hourly);
  if (annual >= target.annual) return null;
  const gap = target.annual - annual;
  const monthly = Math.ceil(gap / 12);
  const hours = Math.ceil(monthly / hourly);
  return {
    id: "income:gap",
    kind: "income",
    statement:
      `The highest median wage found, ${best.title} at ${dollars.format(annual)}/year, leaves ${dollars.format(gap)}/year ` +
      `(${dollars.format(monthly)}/month) to reach the ${dollars.format(target.annual)}/year target. ` +
      `At that occupation's median of ${cents.format(hourly)}/hour, closing it takes about ${hours} hours a month of paid side work, ` +
      `or a second household income of at least ${dollars.format(gap)}/year.`,
    source: {
      name: best.source_name,
      observationPeriod: best.observation_period,
      asOf: best.source_as_of,
      verificationAuthority: best.verification_authority,
      url: best.source_url,
    },
  };
}

/** RCW 49.58.110, as read on the Legislature's site. */
export const PAY_TRANSPARENCY_CHECKED = "2026-10-02";

export function payTransparencyClaim(): IncomeClaim {
  return {
    id: "law:rcw-49.58.110",
    kind: "income",
    statement:
      "Washington's pay transparency law requires employers with 15 or more employees to list the wage scale or salary range (or the fixed wage) " +
      "and a general description of benefits in every job posting, and to give an employee offered a promotion or internal transfer the new " +
      'position\'s range on request. (Source text: "The employer must disclose in each posting for each job opening: (i) The wage scale or salary range"; ' +
      '"This section only applies to employers with 15 or more employees.")',
    source: {
      name: "RCW 49.58.110: Disclosure of wage or salary range by employer",
      observationPeriod: null,
      asOf: PAY_TRANSPARENCY_CHECKED,
      verificationAuthority: "Washington State Legislature",
      url: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.58.110",
    },
  };
}

/** One occupation's Washington wages, annualized, and compared with the income target if there is one. */
export function wageClaim(w: OccupationWage, target: IncomeTarget | null): IncomeClaim | null {
  const median = w.median_hourly != null ? Number(w.median_hourly) : null;
  const p25 = w.p25_hourly != null ? Number(w.p25_hourly) : null;
  const p75 = w.p75_hourly != null ? Number(w.p75_hourly) : null;
  const meanAnnual = w.mean_annual != null ? Number(w.mean_annual) : null;
  if (median == null && meanAnnual == null) return null;

  const where = w.area_name === "Washington" ? "statewide in Washington" : `in the ${w.area_name} area`;
  const parts = [`${w.title} (SOC ${w.soc_code}), ${where}:`];
  if (median != null) {
    parts.push(`median wage ${cents.format(median)}/hour (${dollars.format(annualize(median))}/year at ${people.format(FULL_TIME_HOURS)} hours).`);
  }
  if (p25 != null && p75 != null) {
    parts.push(
      `The middle half earn ${cents.format(p25)}–${cents.format(p75)}/hour (${dollars.format(annualize(p25))}–${dollars.format(annualize(p75))}/year).`,
    );
  }
  if (median == null && meanAnnual != null) parts.push(`Annual mean wage ${dollars.format(meanAnnual)}.`);
  if (w.employment != null) parts.push(`About ${people.format(w.employment)} people hold this job there.`);

  if (target) {
    const goal = dollars.format(target.annual);
    const compare = (label: string, annual: number) =>
      annual >= target.annual
        ? `the ${label} meets it (${dollars.format(annual - target.annual)}/year above)`
        : `the ${label} falls short by ${dollars.format(target.annual - annual)}/year`;
    const checks = [
      median != null ? compare("median", annualize(median)) : meanAnnual != null ? compare("annual mean", meanAnnual) : null,
      p75 != null ? compare("75th percentile", annualize(p75)) : null,
    ].filter(Boolean);
    parts.push(`Against the ${goal}/year housing-based income target: ${checks.join("; ")}.`);
  }

  return {
    id: `wage:${w.area_name}:${w.soc_code}`,
    kind: "wage",
    statement: parts.join(" "),
    source: {
      name: w.source_name,
      observationPeriod: w.observation_period,
      asOf: w.source_as_of,
      verificationAuthority: w.verification_authority,
      url: w.source_url,
    },
  };
}

/**
 * Picks the most local wage row per SOC code (the person's area, else statewide) and orders
 * them by median wage, highest first.
 */
export function localWages(rows: OccupationWage[], areaName: string, limit = 6): OccupationWage[] {
  const bySoc = new Map<string, OccupationWage>();
  for (const row of rows) {
    const existing = bySoc.get(row.soc_code);
    if (!existing || (row.area_name === areaName && existing.area_name !== areaName)) bySoc.set(row.soc_code, row);
  }
  const pay = (w: OccupationWage) => Number(w.median_hourly ?? 0) * FULL_TIME_HOURS || Number(w.mean_annual ?? 0);
  return [...bySoc.values()].sort((a, b) => pay(b) - pay(a)).slice(0, limit);
}
