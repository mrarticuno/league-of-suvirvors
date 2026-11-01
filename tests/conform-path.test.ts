import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Actor } from '../src/assets';

// followPath only touches the rig it is given, so it runs on a hand-built chain without a loaded model
const follow = (Actor.prototype as unknown as { followPath(rig: unknown): void }).followPath;

it('restores the animated pose of a joint the mixer did not rewrite (held key) before bending it again', () => {
  const root = new THREE.Object3D();
  const joints = [0, 1, 2].map(() => new THREE.Object3D());
  root.add(joints[0]); joints[0].add(joints[1]); joints[1].add(joints[2]);
  joints[1].position.set(0, 0, -100); joints[2].position.set(0, 0, -100);
  const q = () => joints.map(() => new THREE.Quaternion());
  const rig = { joints, trail: joints.map(() => new THREE.Vector3()), pose: q(), bent: q() };
  const animated = joints[0].quaternion.clone();

  follow(rig); // first frame: records the trail
  root.position.x = 50; // a sidestep: the tail trails behind, joint 0 turns
  follow(rig);
  expect(joints[0].quaternion.angleTo(animated)).toBeGreaterThan(0.1);
  root.position.x = 10000; // a blink: no bend this frame, and the mixer wrote nothing (held key)
  follow(rig);
  expect(joints[0].quaternion.angleTo(animated)).toBeLessThan(1e-9);
});
