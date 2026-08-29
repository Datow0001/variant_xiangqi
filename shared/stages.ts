import { LoadoutItem } from './types';

export interface StageDefinition {
  id: 1 | 2 | 3;
  name: string;
  budget: number;
  movetimeMs: number;
  description: string;
  defaultBlackLoadouts: LoadoutItem[];
}

export const STAGES: Record<1 | 2 | 3, StageDefinition> = {
  1: {
    id: 1,
    name: '初出茅廬',
    budget: 0,
    movetimeMs: 300,
    description: 'AI 使用純傳統象棋陣容（0 點升級），適合新手熟悉變體棋子機制。',
    defaultBlackLoadouts: [],
  },
  2: {
    id: 2,
    name: '初試鋒芒',
    budget: 5,
    movetimeMs: 800,
    description: 'AI 擁有 1 隻天馬與 1 隻飛象（5 點預算），考驗跨河象與無拐腳馬防守。',
    defaultBlackLoadouts: [
      { position: 'b9', upgradeId: 'TIAN_MA' },
      { position: 'g9', upgradeId: 'FEI_XIANG' },
    ],
  },
  3: {
    id: 3,
    name: '巔峰對決',
    budget: 10,
    movetimeMs: 1500,
    description: 'AI 擁有雙迫擊砲、飛象與雙突擊兵（10 點滿額預算），火力最大化的變體大決戰。',
    defaultBlackLoadouts: [
      { position: 'b7', upgradeId: 'PO_JI_PAO' },
      { position: 'h7', upgradeId: 'PO_JI_PAO' },
      { position: 'c9', upgradeId: 'FEI_XIANG' },
      { position: 'e6', upgradeId: 'TU_JI_BING' },
      { position: 'g6', upgradeId: 'TU_JI_BING' },
    ],
  },
};

/**
 * 取得指定關卡與陣營的 AI 升級陣容 (若 AI 執紅，座標鏡射至紅方半場)
 */
export function getAiLoadout(stageId: 1 | 2 | 3, aiColor: 'red' | 'black'): LoadoutItem[] {
  const stage = STAGES[stageId] || STAGES[1];
  const blackLoadouts = stage.defaultBlackLoadouts;

  if (aiColor === 'black') {
    return [...blackLoadouts];
  }

  // 鏡射至紅方 (Rank 9 -> 0, Rank 7 -> 2, Rank 6 -> 3)
  return blackLoadouts.map((item) => {
    const col = item.position.charAt(0);
    const blackRank = parseInt(item.position.charAt(1), 10);
    const redRank = 9 - blackRank;
    return {
      position: `${col}${redRank}`,
      upgradeId: item.upgradeId,
    };
  });
}
