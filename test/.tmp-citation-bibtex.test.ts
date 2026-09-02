import assert from "node:assert/strict";
import test from "node:test";

import { parseBibtexCitationJs } from "@/lib/citation";
import { referenceFields, type BibEntry } from "@/lib/bibtex";

const fixture = String.raw`
@comment{This entry must stay out of the references.}
@preamble{"This preamble must stay out of the references."}
@article{article-key,
  author = {Doe, Jane and John Smith and García, María},
  title = {Nested {title} {with braces}},
  journal = {Journal of {Nested} Studies},
  publisher = {Publisher House},
  note = {An article note},
  year = {2024},
  doi = {10.1000/example},
  url = {https://example.com/article}
}
@inproceedings{proceedings-key,
  editor = {Smith, Alice and Bob Brown},
  title = "Proceedings {Venue}",
  booktitle = {Proceedings of {Nested} Conference},
  school = {Research School},
  institution = {Research Institute},
  howpublished = {Online archive},
  note = {Proceedings note},
  date = {2023-06-07},
  doi = {10.1000/proceedings},
  url = {https://example.com/proceedings}
}
`;

function entryByKey(entries: BibEntry[], key: string): BibEntry {
  const entry = entries.find((candidate) => candidate.key === key);
  assert.ok(entry, `expected ${key} to be parsed`);
  return entry;
}

test("Citation.js preserves every bibliography field used by the paper", () => {
  const entries = parseBibtexCitationJs(fixture);
  assert.ok(entries, "the fixture should produce bibliography entries");
  assert.deepEqual(entries.map((entry) => entry.key), ["article-key", "proceedings-key"]);

  const article = entryByKey(entries, "article-key");
  assert.equal(article.type, "article");
  assert.deepEqual(article.fields, {
    author: "Doe, Jane and Smith, John and García, María",
    doi: "10.1000/example",
    journal: "Journal of Nested Studies",
    note: "An article note",
    publisher: "Publisher House",
    title: "Nested title with braces",
    url: "https://example.com/article",
    year: "2024",
  });
  assert.deepEqual(referenceFields(article), {
    authors: "J. Doe, J. Smith and M. García",
    title: "Nested title with braces",
    venue: "Journal of Nested Studies",
    year: "2024",
    url: "https://example.com/article",
  });

  const proceedings = entryByKey(entries, "proceedings-key");
  assert.equal(proceedings.type, "paper-conference");
  assert.deepEqual(proceedings.fields, {
    booktitle: "Proceedings of Nested Conference",
    date: "2023-06-07",
    doi: "10.1000/proceedings",
    editor: "Smith, Alice and Brown, Bob",
    howpublished: "Online archive",
    institution: "Research Institute",
    note: "Proceedings note",
    school: "Research School",
    title: "Proceedings Venue",
    url: "https://example.com/proceedings",
  });
  assert.deepEqual(referenceFields(proceedings), {
    authors: "A. Smith and B. Brown",
    title: "Proceedings Venue",
    venue: "Proceedings of Nested Conference",
    year: "2023-06-07",
    url: "https://example.com/proceedings",
  });
});
