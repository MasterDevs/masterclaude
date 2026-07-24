# Algorithm Pattern Catalog
One row per pattern. `Reach for when` = the problem shape to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied. Learning fills this catalog over time.
[seed v1]

| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Memoization / DP | Cache overlapping subproblem results | Recursion recomputes the same subproblems; optimal-substructure problem | No overlap/optimal substructure — memo just adds memory |
| Two-Pointer | Scan from both ends or lead/lag on ordered data | Pair/subarray search on a sorted array or linked list; nested loop over the same sequence | Data unordered and sorting isn't worth it |
| Sliding Window | Maintain a moving contiguous range | "Longest/shortest/sum-of subarray/substring satisfying X"; recomputing over shifting ranges | Ranges aren't contiguous |
| Divide & Conquer | Split, solve parts, combine | Problem splits into independent same-shape subproblems (sort, closest-pair) | Subproblems overlap → DP; or no clean split |
| Greedy (with proof obligation) | Take the locally optimal choice | A stated exchange/matroid argument proves local ⇒ global optimum | Can't prove it — greedy silently returns wrong answers → use DP/search |
| Binary Search on answer | Search the answer space, not the input | Monotonic feasibility predicate over a numeric answer ("min capacity such that…") | No monotonic predicate |
