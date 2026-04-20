/**
 * Bellman-Ford Arbitrage Detector
 * 
 * Finds negative cycles in price graphs using Bellman-Ford algorithm.
 * A negative cycle means you can trade and end up with more tokens than you started.
 * 
 * This is the proper way to detect arbitrage (not just spread detection).
 */

interface PriceEdge {
  from: string;
  to: string;
  rate: number; // price of 'to' in terms of 'from'
  dex: string;
  poolAddress: string;
}

interface NegativeCycle {
  tokens: string[];
  rate: number; // profit multiplier (e.g., 1.005 = 0.5% profit)
  edges: PriceEdge[];
  profitPercent: number;
}

export class BellmanFordDetector {
  private edges: PriceEdge[] = [];
  private tokens: Set<string> = new Set();

  /**
   * Add a price edge (swap pair)
   */
  addEdge(
    tokenFrom: string,
    tokenTo: string,
    rate: number,
    dex: string,
    poolAddress: string
  ) {
    this.edges.push({
      from: tokenFrom.toLowerCase(),
      to: tokenTo.toLowerCase(),
      rate,
      dex,
      poolAddress,
    });

    this.tokens.add(tokenFrom.toLowerCase());
    this.tokens.add(tokenTo.toLowerCase());
  }

  /**
   * Clear all edges
   */
  clear() {
    this.edges = [];
    this.tokens.clear();
  }

  /**
   * Find all negative cycles using Bellman-Ford algorithm
   */
  findNegativeCycles(): NegativeCycle[] {
    const n = this.tokens.size;
    if (n === 0) return [];

    const tokens = Array.from(this.tokens);
    const dist = new Map<string, number>();
    const parent = new Map<string, { token: string; edge: PriceEdge }>();

    // Initialize distances (using log for easier math)
    for (const token of tokens) {
      dist.set(token, 0);
    }

    // Relax edges n-1 times
    for (let i = 0; i < n - 1; i++) {
      for (const edge of this.edges) {
        const d = (dist.get(edge.from) || 0) + Math.log(edge.rate);

        if (d < (dist.get(edge.to) || 0)) {
          dist.set(edge.to, d);
          parent.set(edge.to, { token: edge.from, edge });
        }
      }
    }

    // Find negative cycles
    const negativeCycles: NegativeCycle[] = [];
    const visited = new Set<string>();

    for (const edge of this.edges) {
      const d = (dist.get(edge.from) || 0) + Math.log(edge.rate);

      if (d < (dist.get(edge.to) || 0)) {
        // Negative cycle found
        if (!visited.has(edge.to)) {
          const cycle = this.extractCycle(edge.to, parent, tokens);

          if (cycle.length > 0) {
            const profitRate = Math.exp(-cycle.reduce((sum, e) => sum + Math.log(e.rate), 0));
            const profitPercent = (profitRate - 1) * 100;

            if (profitPercent > 0.05) { // Only report if profit > 0.05%
              negativeCycles.push({
                tokens: cycle.map(e => e.from),
                rate: profitRate,
                edges: cycle,
                profitPercent,
              });
            }

            for (const e of cycle) {
              visited.add(e.from);
              visited.add(e.to);
            }
          }
        }
      }
    }

    return negativeCycles;
  }

  /**
   * Extract cycle from parent pointers
   */
  private extractCycle(
    start: string,
    parent: Map<string, { token: string; edge: PriceEdge }>,
    tokens: string[]
  ): PriceEdge[] {
    const cycle: PriceEdge[] = [];
    let current = start;

    for (let i = 0; i < tokens.length; i++) {
      const p = parent.get(current);
      if (!p) break;

      cycle.push(p.edge);
      current = p.token;

      if (current === start && cycle.length > 1) {
        return cycle;
      }
    }

    return [];
  }

  /**
   * Find 2-hop arbitrage (A → B → A)
   * Simpler than Bellman-Ford but faster
   */
  findTwoHopArbitrage(minProfitPercent: number = 0.1): NegativeCycle[] {
    const cycles: NegativeCycle[] = [];

    // For each token pair
    for (const tokenA of this.tokens) {
      for (const tokenB of this.tokens) {
        if (tokenA === tokenB) continue;

        // Find all paths A → B
        const edgesAB = this.edges.filter(e => e.from === tokenA && e.to === tokenB);

        // Find all paths B → A
        const edgesBA = this.edges.filter(e => e.from === tokenB && e.to === tokenA);

        // Check each combination
        for (const edgeAB of edgesAB) {
          for (const edgeBA of edgesBA) {
            const profitRate = edgeAB.rate * edgeBA.rate;
            const profitPercent = (profitRate - 1) * 100;

            if (profitPercent > minProfitPercent) {
              cycles.push({
                tokens: [tokenA, tokenB],
                rate: profitRate,
                edges: [edgeAB, edgeBA],
                profitPercent,
              });
            }
          }
        }
      }
    }

    return cycles;
  }

  /**
   * Find 3-hop arbitrage (A → B → C → A)
   */
  findThreeHopArbitrage(minProfitPercent: number = 0.05): NegativeCycle[] {
    const cycles: NegativeCycle[] = [];

    for (const tokenA of this.tokens) {
      for (const tokenB of this.tokens) {
        if (tokenA === tokenB) continue;

        const edgesAB = this.edges.filter(e => e.from === tokenA && e.to === tokenB);

        for (const edgeAB of edgesAB) {
          for (const tokenC of this.tokens) {
            if (tokenC === tokenA || tokenC === tokenB) continue;

            const edgesBC = this.edges.filter(e => e.from === tokenB && e.to === tokenC);

            for (const edgeBC of edgesBC) {
              const edgesCA = this.edges.filter(e => e.from === tokenC && e.to === tokenA);

              for (const edgeCA of edgesCA) {
                const profitRate = edgeAB.rate * edgeBC.rate * edgeCA.rate;
                const profitPercent = (profitRate - 1) * 100;

                if (profitPercent > minProfitPercent) {
                  cycles.push({
                    tokens: [tokenA, tokenB, tokenC],
                    rate: profitRate,
                    edges: [edgeAB, edgeBC, edgeCA],
                    profitPercent,
                  });
                }
              }
            }
          }
        }
      }
    }

    return cycles;
  }

  /**
   * Get all edges
   */
  getEdges(): PriceEdge[] {
    return [...this.edges];
  }

  /**
   * Get all tokens
   */
  getTokens(): string[] {
    return Array.from(this.tokens);
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      tokens: this.tokens.size,
      edges: this.edges.length,
      averageEdgesPerToken: this.edges.length / Math.max(1, this.tokens.size),
    };
  }
}
