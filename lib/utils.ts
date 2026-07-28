import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// className 合并工具（shadcn 约定）
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
