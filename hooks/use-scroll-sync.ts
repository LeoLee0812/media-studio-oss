"use client";
import { useCallback, useMemo, useRef } from "react";

// ===== 双栏比例滚动同步（VS Code Markdown 预览式）=====
// 左侧 Markdown 编辑区（textarea）与右侧渲染预览各自可滚动，
// 谁被用户滚动谁就是主动方，另一侧按「滚动进度百分比」跟随。
// 纯文本行高与渲染后块高度不完全线性，比例同步是编辑器预览的通行近似做法。
//
// 防回环：程序性设置 scrollTop 也会触发对方的 scroll 事件，
// 用 suppress 标记吃掉这次「被动滚动」，避免两侧互相触发抖动。

interface SyncSide {
  /** 挂到元素上的 ref 回调 */
  ref: (el: HTMLElement | null) => void;
  /** 挂到元素上的 onScroll */
  onScroll: () => void;
}

export function useScrollSync(): { left: SyncSide; right: SyncSide } {
  const els = useRef<(HTMLElement | null)[]>([null, null]);
  // suppress[i] 为 true 表示 i 侧下一次 scroll 事件是程序性同步产生的，应忽略
  const suppress = useRef<boolean[]>([false, false]);

  const makeSide = useCallback((idx: 0 | 1): SyncSide => {
    const other = idx === 0 ? 1 : 0;
    return {
      ref: (el: HTMLElement | null) => {
        els.current[idx] = el;
      },
      onScroll: () => {
        if (suppress.current[idx]) {
          suppress.current[idx] = false;
          return;
        }
        const from = els.current[idx];
        const to = els.current[other];
        if (!from || !to) return;
        const fromMax = from.scrollHeight - from.clientHeight;
        const toMax = to.scrollHeight - to.clientHeight;
        if (fromMax <= 0 || toMax <= 0) return;
        const next = (from.scrollTop / fromMax) * toMax;
        // 差异小于 1px 不动，避免无意义的事件循环
        if (Math.abs(to.scrollTop - next) < 1) return;
        suppress.current[other] = true;
        to.scrollTop = next;
      },
    };
  }, []);

  // 两侧结构固定，makeSide 稳定，因此只创建一次
  return useMemo(() => ({ left: makeSide(0), right: makeSide(1) }), [makeSide]);
}
