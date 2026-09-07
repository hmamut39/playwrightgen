import { describe, expect, it } from "vitest";

import { personName, UNKNOWN_PERSON } from "@/lib/format/person-name";

const REPLACEMENT = String.fromCharCode(0xfffd);

describe("displaying a person's name", () => {
  it("returns an ordinary name unchanged", () => {
    expect(personName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("keeps names written in other scripts", () => {
    // These are real names. If they render as boxes that is a missing font on
    // the reader's machine, not damaged data, and dropping them would mangle
    // the names of the people least well served by software written in English.
    expect(personName("ھەسەنجان")).toBe("ھەسەنجان");
    expect(personName("李雷")).toBe("李雷");
  });

  it("drops characters whose bytes were already lost", () => {
    // U+FFFD is what a decoder leaves behind when it could not recover the
    // original bytes. Nothing downstream can restore them, so showing them adds
    // nothing but noise in the middle of a name.
    expect(personName(`ھەسەن${REPLACEMENT}جان`)).toBe("ھەسەنجان");
  });

  it("falls back when nothing readable survives", () => {
    expect(personName(REPLACEMENT + REPLACEMENT)).toBe(UNKNOWN_PERSON);
    expect(personName("")).toBe(UNKNOWN_PERSON);
    expect(personName("   ")).toBe(UNKNOWN_PERSON);
    expect(personName(null)).toBe(UNKNOWN_PERSON);
    expect(personName(undefined)).toBe(UNKNOWN_PERSON);
  });

  it("collapses the whitespace a removed character leaves behind", () => {
    expect(personName(`Ada ${REPLACEMENT} Lovelace`)).toBe("Ada Lovelace");
  });
});
