"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";

// Register GSAP plugins once here and import gsap from "@/lib/gsap" everywhere.
gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };
