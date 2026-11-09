import { describe, expect, it, vi } from "vitest";
import { httpJobsPorts } from "./remote-ports";

function setup(answer: (url: string) => Response) {
  const fetchImpl = vi.fn(async (url: string) => answer(url));
  const ports = httpJobsPorts({
    platform: { url: "https://platform.test", token: "p" },
    taxonomy: { url: "https://taxonomy.test", token: "t" },
    companies: { url: "https://companies.test", token: "c" },
    billing: { url: "https://billing.test", token: "b" },
    notifications: { url: "https://notifications.test", token: "n" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const sent = (i = 0) => fetchImpl.mock.calls[i] as unknown as [string, RequestInit];
  return { ports, sent };
}
const auth = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

describe("jobs remote ports", () => {
  it("asks each service with its own token", async () => {
    const { ports, sent } = setup((url) =>
      url.includes("taxonomy")
        ? Response.json({ skillIds: ["s1"] })
        : url.includes("billing")
          ? Response.json({ jobIds: ["j1"] })
          : Response.json({ role: "owner" }),
    );
    await expect(ports.extractSkillIds("React")).resolves.toEqual(["s1"]);
    expect(sent(0)[0]).toBe("https://taxonomy.test/v1/skills/extract");
    expect(auth(sent(0)[1])).toBe("Bearer t");
    await expect(ports.promotedHireJobIds()).resolves.toEqual(["j1"]);
    expect(auth(sent(1)[1])).toBe("Bearer b");
    await expect(ports.findMemberRole("c1", "u1")).resolves.toBe("owner");
    expect(sent(2)[0]).toBe("https://companies.test/v1/companies/c1/members/u1/role");
  });

  it("reads the member role of each company for team posts", async () => {
    const { ports, sent } = setup(() =>
      Response.json({ companies: [{ id: "c1", origin: "internal", role: "owner" }] }),
    );
    await expect(ports.companiesForUser("u1")).resolves.toEqual([{ id: "c1", origin: "internal", role: "owner" }]);
    expect((sent()[1].headers as Record<string, string>)["x-user-id"]).toBe("u1");
  });

  it("maps an unknown account to null and a platform 429 to a rate-limit error", async () => {
    const { ports } = setup((url) =>
      url.includes("active-user") ? new Response(null, { status: 404 }) : new Response(null, { status: 429 }),
    );
    await expect(ports.activeUser("u1")).resolves.toBeNull();
    await expect(ports.rateLimit("jobCreateVerified", "c1")).rejects.toMatchObject({ status: 429 });
  });

  it("never throws when a notice fails", async () => {
    const { ports } = setup(() => new Response(null, { status: 503 }));
    await expect(ports.notify("job.closed", ["u"], {})).resolves.toBeUndefined();
  });
});
