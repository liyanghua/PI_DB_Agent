import { analyzeKeywordCompetition } from "../src/services/keyword_competition/index.js";

const r = await analyzeKeywordCompetition({
  category: "入户地垫",
  category_id: "121364010",
  live: false,
  top_n: 5,
});
console.log(JSON.stringify(r, null, 2).slice(0, 2000));