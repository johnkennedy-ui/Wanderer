import { Capacitor } from "@capacitor/core";
import * as THREE from "three";

export const usesBrowserAuthority = () => [
  Capacitor,
  THREE,
  window.localStorage,
  Math.random(),
];
