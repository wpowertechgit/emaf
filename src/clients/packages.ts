/** A package found in a language registry. */
export interface PackageHit {
  ecosystem: "npm" | "PyPI";
  name: string;
  description: string;
  version: string;
  /** Date of the latest release when known (ISO date). */
  date: string;
  url: string;
  repositoryUrl: string;
}
