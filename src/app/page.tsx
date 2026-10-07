import Link from "next/link";

const FEATURES = [
  {
    href: "/rcms",
    title: "RCMS 사용실적보고서 조회",
    description: "과제번호 목록으로 RCMS 사용실적보고서의 기관명·연구책임자·연구기간·공동기관을 모읍니다.",
    upload: '엑셀에 "과제번호" 열 필요',
    accent: "bg-pink-600 hover:bg-pink-700",
    ring: "ring-pink-100 hover:ring-pink-300",
    titleColor: "text-pink-900",
  },
  {
    href: "/ezbaro",
    title: "이지바로 연구원정보 수집",
    description: "이지바로 상시점검 관리 화면에서 과제별 기관·사업자번호·연구책임자 연락처를 모읍니다.",
    upload: "엑셀 1열 과제번호, 2열 년도",
    accent: "bg-violet-600 hover:bg-violet-700",
    ring: "ring-violet-100 hover:ring-violet-300",
    titleColor: "text-violet-900",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">정산 업무 자동화</h1>
        <p className="mt-1 text-sm text-slate-500">사용할 기능을 선택하세요.</p>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className={`flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 transition ${f.ring}`}
            >
              <h2 className={`text-lg font-bold ${f.titleColor}`}>{f.title}</h2>
              <p className="mt-2 flex-1 text-sm text-gray-600">{f.description}</p>
              <p className="mt-3 text-xs text-gray-400">{f.upload}</p>
              <span className={`mt-5 rounded-full py-2.5 text-center font-semibold text-white ${f.accent}`}>
                시작하기
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
