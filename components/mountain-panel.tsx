import Image from "next/image";

type MountainPanelProps = {
  eyebrow: string;
  title: string;
  body: string;
  scene?: "valley" | "porch" | "road" | "chapel";
};

const sceneImages = {
  valley: {
    src: "/images/mountain-study/valley-sunrise.png",
    alt: "Sunrise over a misty Wears Valley inspired pasture and Smoky Mountain ridges.",
  },
  porch: {
    src: "/images/mountain-study/cabin-study-porch.png",
    alt: "Cabin porch study table with Bible, notebook, pen, microphone, and Smoky Mountain view.",
  },
  road: {
    src: "/images/mountain-study/rural-road.png",
    alt: "Quiet rural Tennessee road beside a fence line with Smoky Mountain ridges beyond.",
  },
  chapel: {
    src: "/images/mountain-study/mountain-chapel.png",
    alt: "Small mountain chapel near a field in morning light with Smoky Mountain ridges behind it.",
  },
};

export function MountainPanel({ eyebrow, title, body, scene = "valley" }: MountainPanelProps) {
  const image = sceneImages[scene];

  return (
    <section className={`mountain-panel mountain-panel--${scene}`} aria-label={title}>
      <div className="mountain-panel__image">
        <Image src={image.src} alt={image.alt} fill sizes="(max-width: 720px) 100vw, 45vw" priority={scene === "chapel"} />
      </div>
      <div className="mountain-panel__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </section>
  );
}
