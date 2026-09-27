import { redirect } from 'next/navigation';

/** 默认视图：总览 · 未完成 */
export default function HomePage() {
  redirect('/list/todo');
}
