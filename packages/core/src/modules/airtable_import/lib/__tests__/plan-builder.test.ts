import { topologicalSort } from "../plan-builder";

describe("topologicalSort", () => {
  it("sorts tables with no relations first", () => {
    const relations: Record<string, string[]> = {
      tbl1: [],
      tbl2: ["tbl1"], // tbl2 depends on tbl1
    };
    const result = topologicalSort(["tbl1", "tbl2"], relations);
    expect(result.indexOf("tbl1")).toBeLessThan(result.indexOf("tbl2"));
  });

  it("handles cycles by returning all tables", () => {
    const relations: Record<string, string[]> = {
      tbl1: ["tbl2"],
      tbl2: ["tbl1"], // cycle
    };
    const result = topologicalSort(["tbl1", "tbl2"], relations);
    expect(result).toHaveLength(2);
  });

  it("handles tables with no relations", () => {
    const result = topologicalSort(["tbl1", "tbl2", "tbl3"], {});
    expect(result).toHaveLength(3);
  });
});
