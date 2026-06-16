import fs from "node:fs";

export type ApiAssetCard = {
  api_id: string;
  name: string;
  module: string;
  domain: string;
  method: string;
  path: string;
  lifecycle_status: string;
  quality_score: number;
  issue_marker?: string;
};

export class ApiAssetRegistry {
  constructor(private cards: ApiAssetCard[]) {}

  static fromJsonFile(file: string): ApiAssetRegistry {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    return new ApiAssetRegistry(raw.api_asset_cards ?? raw.apis ?? []);
  }

  search(query: string, opts?: { domain?: string; limit?: number }): ApiAssetCard[] {
    const q = query.toLowerCase();
    const scored = this.cards
      .filter(c => !opts?.domain || c.domain === opts.domain)
      .map(c => {
        const hay = `${c.name} ${c.module} ${c.domain} ${c.path}`.toLowerCase();
        let score = 0;
        if (hay.includes(q)) score += 1;
        for (const token of q.split(/\s+/).filter(Boolean)) {
          if (hay.includes(token)) score += 0.2;
        }
        score += (c.quality_score ?? 0) * 0.5;
        if (c.lifecycle_status === "draft") score -= 0.2;
        return { c, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts?.limit ?? 5).map(x => x.c);
  }
}
