import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";

export interface FxFeed {
  asOf: string;
  eurRates: Record<string, { value: string; asOf: string }>;
}
export function parseEcbCsv(csv: string): FxFeed {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",").map((v) => v.replace(/^"|"$/g, "")) ?? [];
  const currencyColumn = header.indexOf("CURRENCY");
  const periodColumn = header.indexOf("TIME_PERIOD");
  const valueColumn = header.indexOf("OBS_VALUE");
  if (currencyColumn < 0 || periodColumn < 0 || valueColumn < 0)
    throw new Error("Invalid ECB CSV schema");
  const rates: Record<string, { value: string; asOf: string }> = {};
  let asOf = "";
  for (const line of lines.slice(1)) {
    const row = line.split(",").map((v) => v.replace(/^"|"$/g, ""));
    const currency = row[currencyColumn];
    const date = row[periodColumn];
    const value = row[valueColumn];
    if (
      currency &&
      date &&
      value &&
      /^\d+(\.\d+)?$/.test(value) &&
      (!rates[currency] || rates[currency].asOf < date)
    ) {
      rates[currency] = { value, asOf: date };
      if (date > asOf) asOf = date;
    }
  }
  if (!rates.USD || !asOf)
    throw new Error("ECB response has no USD reference rate");
  rates.EUR = { value: "1", asOf: rates.USD.asOf };
  return { asOf, eurRates: rates };
}

export async function refreshFxRates(fetcher: typeof fetch = fetch) {
  const response = await fetcher(
    "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&format=csvdata",
    {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`ECB returned ${response.status}`);
  const feed = parseEcbCsv(await response.text());
  const tuples = Object.entries(feed.eurRates).map(
    ([currency, observation]) =>
      sql`(${currency}, ${observation.value}::numeric, ${observation.asOf}::date)`,
  );
  const rates = sql.join(tuples, sql`, `);
  await getDb().execute(sql`
    with ecb(currency, per_eur, as_of) as (values ${rates})
    insert into public.fx_rates(currency, rate_to_usd, as_of)
    -- rate_to_usd is USD per 1 unit of the currency (D275): the ECB feed gives
    -- units per 1 EUR, so USD per 1 X = per_eur(USD) / per_eur(X).
    select ecb.currency, case when ecb.currency='USD' then 1::numeric else round(usd.per_eur / ecb.per_eur, 8) end, ecb.as_of
    from ecb join lateral (select per_eur from ecb u where u.currency='USD' and u.as_of <= ecb.as_of order by u.as_of desc limit 1) usd on true
    where ecb.per_eur > 0
    on conflict(currency, as_of) do update set rate_to_usd=excluded.rate_to_usd
  `);
  return { asOf: feed.asOf, currencies: Object.keys(feed.eurRates).length };
}
