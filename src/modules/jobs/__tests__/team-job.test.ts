import { describe, expect, it } from "vitest";
import { pickPosterCompany, teamJobFields } from "../service/team-job";

const companyId = "00000000-0000-4000-8000-000000000010";

describe("team job from a bot brief", () => {
  it("turns a role and criteria into a remote internal job", () => {
    const fields = teamJobFields(companyId, {
      title: "Support engineer",
      criteria:
        "A person who has done customer support for a year and can write in English. Remote, contract.",
      category: "support",
      employmentType: "contract",
      skills: ["customer support"],
    });
    expect(fields.companyId).toBe(companyId);
    expect(fields.title).toBe("Support engineer");
    expect(fields.description).toContain("customer support");
    expect(fields.workFormat).toBe("remote");
    expect(fields.applicationMethod).toBe("internal");
    expect(fields.skills).toEqual([{ name: "customer support", weight: 2 }]);
  });

  it("picks an internal company the person can post for", () => {
    expect(
      pickPosterCompany([
        { id: "imported", origin: "imported", role: "owner" },
        { id: "member", origin: "internal", role: "member" },
        { id: "owned", origin: "internal", role: "owner" },
      ]),
    ).toBe("owned");
    expect(pickPosterCompany([])).toBeNull();
  });
});
