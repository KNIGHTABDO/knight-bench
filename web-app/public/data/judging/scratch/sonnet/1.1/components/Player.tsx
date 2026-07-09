"use client";
export default function Player(props: { src: string; subtitles?: any; onProgress?: (p: number) => void }){ return <video src={props.src} />; }
