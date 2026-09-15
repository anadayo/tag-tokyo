import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TAG TOKYO",
    short_name: "TAG TOKYO",
    description: "東京ですれ違った人と、あとからつながる。",
    start_url: "/tag-tokyo/",
    display: "standalone",
    background_color: "#fffdfb",
    theme_color: "#fffdfb",
    icons: [
      { src: "/tag-tokyo/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/tag-tokyo/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
