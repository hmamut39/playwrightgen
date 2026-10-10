import { describe, expect, it } from "vitest";

import { parseGitHubIssueUrl } from "@/lib/services/ticket-fetch";

/**
 * Which addresses are read, and which are declined rather than guessed at.
 *
 * The parser decides what the product will go and fetch with a repository
 * token, so it is deliberately narrow: github.com, over https, pointing at an
 * issue. Everything else is refused here rather than turned into a request
 * that might reach somewhere nobody intended.
 */
describe("the address of a ticket", () => {
  it("reads an ordinary issue address", () => {
    expect(parseGitHubIssueUrl("https://github.com/acme/web/issues/123")).toEqual({
      owner: "acme",
      repository: "web",
      number: 123,
    });
  });

  it("ignores what people paste along with it", () => {
    // A comment anchor and a tracking query are how an address usually arrives.
    expect(
      parseGitHubIssueUrl("  https://github.com/acme/web/issues/7?foo=bar#issuecomment-99  "),
    ).toEqual({ owner: "acme", repository: "web", number: 7 });
    expect(parseGitHubIssueUrl("https://www.github.com/acme/web/issues/7")).toMatchObject({
      number: 7,
    });
  });

  it("declines anything that is not a github.com issue", () => {
    for (const value of [
      "",
      "not a url",
      // Another host entirely: following this would be a request to somewhere
      // nobody chose.
      "https://evil.example.com/acme/web/issues/1",
      // A lookalike host.
      "https://github.com.evil.example.com/acme/web/issues/1",
      // Enterprise GitHub needs its own App and its own decision.
      "https://github.acme.internal/acme/web/issues/1",
      // Not https.
      "http://github.com/acme/web/issues/1",
      // A pull request address, which the fetch also refuses on the response.
      "https://github.com/acme/web/pull/1",
      // A repository, a discussion, an issues list.
      "https://github.com/acme/web",
      "https://github.com/acme/web/issues",
      "https://github.com/acme/web/discussions/1",
      // Numbers that are not issue numbers.
      "https://github.com/acme/web/issues/0",
      "https://github.com/acme/web/issues/-3",
      "https://github.com/acme/web/issues/abc",
      "https://github.com/acme/web/issues/9007199254740993",
    ]) {
      expect(parseGitHubIssueUrl(value), `${value} was accepted`).toBeNull();
    }
  });
});
