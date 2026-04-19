class Particle {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.maxSpeed = 4; // Default speed that will be modified
    this.prevPos = this.pos.copy();
    this.lifespan = 255;
    this.color = color(255); // Default white color
  }

  update() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
    this.lifespan -= 2;
  }

  applyForce(force) {
    this.acc.add(force);
  }

  follow(flowfield) {
    let x = floor(this.pos.x / flowfield.scale);
    let y = floor(this.pos.y / flowfield.scale);
    let index = x + y * flowfield.cols;
    
    if (index >= 0 && index < flowfield.field.length) {
      let force = flowfield.field[index].copy();
      this.applyForce(force);
    }
  }

  show() {
    // Use the particle's color with its lifespan for alpha
    stroke(red(this.color), green(this.color), blue(this.color), this.lifespan);
    strokeWeight(1);
    line(this.pos.x, this.pos.y, this.prevPos.x, this.prevPos.y);
    this.updatePrev();
  }

  updatePrev() {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
  }

  edges() {
    if (this.pos.x > width) {
      this.pos.x = 0;
      this.updatePrev();
    }
    if (this.pos.x < 0) {
      this.pos.x = width;
      this.updatePrev();
    }
    if (this.pos.y > height) {
      this.pos.y = 0;
      this.updatePrev();
    }
    if (this.pos.y < 0) {
      this.pos.y = height;
      this.updatePrev();
    }
  }

  isDead() {
    return this.lifespan <= 0;
  }
} 