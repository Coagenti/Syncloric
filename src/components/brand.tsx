import Image from "next/image";

export function BrandMark() {
  return <Image className="brand-mark" src="/brand/syncloric-mark.png" width={48} height={48} unoptimized alt="" />;
}
export function Brand() {
  return <><BrandMark /><span className="brand-wordmark">SYN<span className="brand-accent">CLORIC</span><small>CALORIE / IN FOCUS</small></span></>;
}
