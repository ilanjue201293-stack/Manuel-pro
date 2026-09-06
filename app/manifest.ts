import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Manuel Pro",
    short_name: "Manuel Pro",
    description: "Messagerie privée",
    start_url: "/",
    display: "standalone",
    background_color: "#101114",
    theme_color: "#101114",
  };
}
