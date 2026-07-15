import Phaser from 'phaser';
import { LevelConfig, MirrorType } from '../../shared/types';
import { simulateLaser } from '../../shared/laserSim';

export interface GameSceneData {
  levelConfig: LevelConfig;
  placedMirrors: Record<string, MirrorType>;
  placedPrisms: Record<string, boolean>;
  selectedMirrorType: MirrorType | null;
  selectedTool: 'mirror' | 'prism' | 'erase';
  cooldownActive: boolean;
  onMoveAttempt: (x: number, y: number, mirrorType: MirrorType | null, placeType?: 'mirror' | 'prism') => void;
}

export class GameScene extends Phaser.Scene {
  private levelConfig!: LevelConfig;
  private placedMirrors!: Record<string, MirrorType>;
  private placedPrisms!: Record<string, boolean>;
  private selectedMirrorType: MirrorType | null = '/';
  private selectedTool: 'mirror' | 'prism' | 'erase' = 'mirror';
  private cooldownActive = false;
  private onMoveAttempt!: (x: number, y: number, mirrorType: MirrorType | null, placeType?: 'mirror' | 'prism') => void;

  // Render variables
  private gridOffset = { x: 50, y: 50 };
  private cellSize = 45;
  private gridWidthPx = 0;
  private gridHeightPx = 0;

  // Game Objects
  private tileOverlays!: Phaser.GameObjects.Group;
  private mirrorObjects: Map<string, Phaser.GameObjects.Container> = new Map();
  private prismObjects: Map<string, Phaser.GameObjects.Container> = new Map();
  private laserGraphics!: Phaser.GameObjects.Graphics;
  private laserParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  
  // Interactive variables
  private hoverCell: { x: number; y: number } | null = null;
  private laserPulseTime = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameSceneData) {
    this.levelConfig = data.levelConfig;
    this.placedMirrors = { ...data.placedMirrors };
    this.placedPrisms = { ...data.placedPrisms };
    this.selectedMirrorType = data.selectedMirrorType;
    this.selectedTool = data.selectedTool || 'mirror';
    this.cooldownActive = data.cooldownActive;
    this.onMoveAttempt = data.onMoveAttempt;
  }

  // Reactive updates from React
  updateState(
    placedMirrors: Record<string, MirrorType>,
    placedPrisms: Record<string, boolean>,
    selectedMirror: MirrorType | null,
    selectedTool: 'mirror' | 'prism' | 'erase',
    cooldown: boolean
  ) {
    this.placedMirrors = { ...placedMirrors };
    this.placedPrisms = { ...placedPrisms };
    this.selectedMirrorType = selectedMirror;
    this.selectedTool = selectedTool;
    this.cooldownActive = cooldown;
    this.rebuildMirrors();
    this.rebuildPrisms();
  }

  preload() {
    // Generate programmatic textures so we don't need external PNG assets
    this.createProgrammaticTextures();
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b0e14');


    // Group for tile overlays
    this.tileOverlays = this.add.group();

    // Calculate layouts
    this.calculateLayout();

    // Draw background grid
    this.drawGridBackground();

    // Build static level obstacles, starts, and targets
    this.buildStaticEntities();

    // Build user mirrors
    this.rebuildMirrors();

    // Create laser path graphics
    this.laserGraphics = this.add.graphics();

    // Create laser hit particles
    this.createLaserParticles();

    // Set up hover/input listeners
    this.setupInputs();

    // Listen to resize
    this.scale.on('resize', this.handleResize, this);
  }

  override update(_time: number, delta: number) {
    this.laserPulseTime += delta * 0.005;
    this.drawLasers();
  }

  private calculateLayout() {
    const margin = 40;
    const availableWidth = this.scale.width - margin * 2;
    const availableHeight = this.scale.height - margin * 2;

    const cellsX = this.levelConfig.width;
    const cellsY = this.levelConfig.height;

    // Determine cell size to fit screen
    this.cellSize = Math.min(
      Math.floor(availableWidth / cellsX),
      Math.floor(availableHeight / cellsY),
      60 // max cell size
    );

    this.gridWidthPx = cellsX * this.cellSize;
    this.gridHeightPx = cellsY * this.cellSize;

    // Centering
    this.gridOffset.x = Math.floor((this.scale.width - this.gridWidthPx) / 2);
    this.gridOffset.y = Math.floor((this.scale.height - this.gridHeightPx) / 2);
  }

  private handleResize() {
    this.calculateLayout();
    this.rebuildGrid();
  }

  private rebuildGrid() {
    this.children.removeAll();
    this.mirrorObjects.clear();
    this.prismObjects.clear();
    this.tileOverlays.clear(true, true);

    this.drawGridBackground();
    this.buildStaticEntities();
    this.rebuildMirrors();
    this.rebuildPrisms();
    this.laserGraphics = this.add.graphics();
    this.createLaserParticles();
    this.setupInputs();
  }

  private createProgrammaticTextures() {
    // 1. Spark particle texture
    if (!this.textures.exists('spark')) {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(3, 3, 3);
      graphics.generateTexture('spark', 6, 6);
    }
  }

  private drawGridBackground() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x1f293d, 0.8);

    for (let x = 0; x <= this.levelConfig.width; x++) {
      const px = this.gridOffset.x + x * this.cellSize;
      graphics.lineBetween(px, this.gridOffset.y, px, this.gridOffset.y + this.gridHeightPx);
    }

    for (let y = 0; y <= this.levelConfig.height; y++) {
      const py = this.gridOffset.y + y * this.cellSize;
      graphics.lineBetween(this.gridOffset.x, py, this.gridOffset.x + this.gridWidthPx, py);
    }

    // Outer border
    graphics.lineStyle(2, 0x3b82f6, 0.4);
    graphics.strokeRect(this.gridOffset.x, this.gridOffset.y, this.gridWidthPx, this.gridHeightPx);
  }

  private buildStaticEntities() {
    this.levelConfig.grid.forEach((cell) => {
      const px = this.gridOffset.x + cell.x * this.cellSize + this.cellSize / 2;
      const py = this.gridOffset.y + cell.y * this.cellSize + this.cellSize / 2;
      const size = this.cellSize * 0.8;

      if (cell.type === 'obstacle') {
        const block = this.add.graphics();
        const color = 0x22d3ee; // Cyan prism color

        // Draw diamond shape centered at (px, py)
        block.fillStyle(color, 0.35);
        block.lineStyle(2.5, color, 1.0);

        block.beginPath();
        block.moveTo(px, py - size / 2);
        block.lineTo(px + size / 2, py);
        block.lineTo(px, py + size / 2);
        block.lineTo(px - size / 2, py);
        block.closePath();
        block.fillPath();
        block.strokePath();

        // Facet lines
        block.lineStyle(1, 0xffffff, 0.6);
        block.lineBetween(px, py - size / 2, px, py + size / 2);
        block.lineBetween(px - size / 2, py, px + size / 2, py);

        // Inner core
        block.fillStyle(0xffffff, 0.85);
        block.fillCircle(px, py, 3.5);
      } 
      else if (cell.type === 'start') {
        // Laser emitter base
        const emitter = this.add.graphics();
        emitter.fillStyle(0x10b981, 0.2);
        emitter.fillCircle(px, py, this.cellSize * 0.4);
        emitter.lineStyle(2, 0x10b981, 1);
        emitter.strokeCircle(px, py, this.cellSize * 0.4);

        // Core emitter
        emitter.fillStyle(0xffffff, 1);
        emitter.fillCircle(px, py, this.cellSize * 0.15);

        // Direction arrow pointer
        emitter.fillStyle(0x10b981, 1);
        const dir = cell.direction || 'right';
        const arrow = this.add.triangle(px, py, 0, 0, 0, 0, 0, 0, 0x10b981);
        
        const arrowOffset = this.cellSize * 0.3;
        if (dir === 'right') {
          arrow.setTo(px + arrowOffset, py, px + arrowOffset - 8, py - 6, px + arrowOffset - 8, py + 6);
        } else if (dir === 'left') {
          arrow.setTo(px - arrowOffset, py, px - arrowOffset + 8, py - 6, px - arrowOffset + 8, py + 6);
        } else if (dir === 'up') {
          arrow.setTo(px, py - arrowOffset, px - 6, py - arrowOffset + 8, px + 6, py - arrowOffset + 8);
        } else if (dir === 'down') {
          arrow.setTo(px, py + arrowOffset, px - 6, py - arrowOffset - 8, px + 6, py - arrowOffset - 8);
        }
      } 
      else if (cell.type === 'target') {
        // Target receiver
        const receiver = this.add.graphics();
        
        // Pulsing background circle
        receiver.fillStyle(0xef4444, 0.15);
        receiver.fillCircle(px, py, this.cellSize * 0.45);
        
        // Outer glowing ring
        receiver.lineStyle(2, 0xef4444, 0.9);
        receiver.strokeCircle(px, py, this.cellSize * 0.4);
        
        // Inner receiver core
        receiver.lineStyle(1.5, 0xffffff, 0.8);
        receiver.strokeCircle(px, py, this.cellSize * 0.2);
        
        // Crosshair ticks
        const tLen = this.cellSize * 0.1;
        receiver.lineStyle(2, 0xef4444, 1);
        receiver.lineBetween(px - this.cellSize * 0.4, py, px - this.cellSize * 0.4 + tLen, py);
        receiver.lineBetween(px + this.cellSize * 0.4, py, px + this.cellSize * 0.4 - tLen, py);
        receiver.lineBetween(px, py - this.cellSize * 0.4, px, py - this.cellSize * 0.4 + tLen);
        receiver.lineBetween(px, py + this.cellSize * 0.4, px, py + this.cellSize * 0.4 - tLen);
      }
    });
  }

  private rebuildMirrors() {
    // Clear old mirrors
    this.mirrorObjects.forEach((container) => container.destroy());
    this.mirrorObjects.clear();

    // Create current mirrors
    Object.entries(this.placedMirrors).forEach(([key, mirrorType]) => {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const container = this.createMirrorContainer(x, y, mirrorType, false);
      this.mirrorObjects.set(key, container);
    });
  }

  private rebuildPrisms() {
    // Clear old prisms
    this.prismObjects.forEach((container) => container.destroy());
    this.prismObjects.clear();

    // Create current prisms
    Object.entries(this.placedPrisms).forEach(([key, placed]) => {
      if (placed) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        const container = this.createPrismContainer(x, y, false);
        this.prismObjects.set(key, container);
      }
    });
  }

  private createPrismContainer(x: number, y: number, isPreview: boolean): Phaser.GameObjects.Container {
    const px = this.gridOffset.x + x * this.cellSize + this.cellSize / 2;
    const py = this.gridOffset.y + y * this.cellSize + this.cellSize / 2;
    const container = this.add.container(px, py);

    const size = this.cellSize * 0.7;
    const graphics = this.add.graphics();
    container.add(graphics);

    const alpha = isPreview ? 0.4 : 0.85;
    const color = 0x22d3ee; // Cyan for prisms

    // Draw diamond shape
    graphics.fillStyle(color, alpha * 0.3);
    graphics.lineStyle(2.5, color, alpha);

    graphics.beginPath();
    graphics.moveTo(0, -size / 2);
    graphics.lineTo(size / 2, 0);
    graphics.lineTo(0, size / 2);
    graphics.lineTo(-size / 2, 0);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();

    // Facet lines
    graphics.lineStyle(1, 0xffffff, alpha * 0.5);
    graphics.lineBetween(0, -size / 2, 0, size / 2);
    graphics.lineBetween(-size / 2, 0, size / 2, 0);

    // Inner core
    graphics.fillStyle(0xffffff, alpha * 0.6);
    graphics.fillCircle(0, 0, 3);

    return container;
  }

  private createMirrorContainer(x: number, y: number, mirrorType: MirrorType, isPreview: boolean): Phaser.GameObjects.Container {
    const px = this.gridOffset.x + x * this.cellSize + this.cellSize / 2;
    const py = this.gridOffset.y + y * this.cellSize + this.cellSize / 2;
    const container = this.add.container(px, py);

    const size = this.cellSize * 0.7;
    const graphics = this.add.graphics();
    container.add(graphics);

    // Style parameters
    const alpha = isPreview ? 0.5 : 1.0;
    const color = isPreview ? 0xa855f7 : 0xec4899; // Purple for preview, pink for active
    
    // Draw diagonal plate
    graphics.lineStyle(4, color, alpha);
    graphics.fillStyle(0xffffff, alpha * 0.25);
    
    // Plate endpoints based on slash type
    let x1 = -size / 2;
    let y1 = size / 2;
    let x2 = size / 2;
    let y2 = -size / 2;

    if (mirrorType === '\\') {
      x1 = -size / 2;
      y1 = -size / 2;
      x2 = size / 2;
      y2 = size / 2;
    }

    // Glass panel
    graphics.lineBetween(x1, y1, x2, y2);

    // Mirror backing indicators (metallic supports on the back)
    graphics.fillStyle(0x9ca3af, alpha);
    graphics.fillCircle(x1, y1, 3);
    graphics.fillCircle(x2, y2, 3);

    // Support stand outline
    graphics.lineStyle(1.5, 0x4b5563, alpha * 0.6);
    graphics.strokeCircle(0, 0, 8);

    return container;
  }

  private createLaserParticles() {
    this.laserParticles = this.add.particles(0, 0, 'spark', {
      lifespan: 400,
      speed: { min: 40, max: 120 },
      scale: { start: 0.8, end: 0 },
      blendMode: 'ADD',
      emitting: false,
      color: [ 0x60a5fa, 0x93c5fd, 0xffffff ]
    });
  }

  private setupInputs() {
    // Setup interactive overlays on all grid cells
    for (let x = 0; x < this.levelConfig.width; x++) {
      for (let y = 0; y < this.levelConfig.height; y++) {
        // Is it a static blocking object?
        const isStatic = this.levelConfig.grid.some((c) => c.x === x && c.y === y && c.type !== 'empty');
        if (isStatic) continue;

        const px = this.gridOffset.x + x * this.cellSize;
        const py = this.gridOffset.y + y * this.cellSize;

        const zone = this.add.rectangle(
          px + this.cellSize / 2,
          py + this.cellSize / 2,
          this.cellSize - 2,
          this.cellSize - 2,
          0xffffff,
          0.0001
        );
        zone.setInteractive();

        zone.on('pointerover', () => {
          this.hoverCell = { x, y };
          zone.setFillStyle(0xffffff, 0.05);
        });

        zone.on('pointerout', () => {
          if (this.hoverCell?.x === x && this.hoverCell?.y === y) {
            this.hoverCell = null;
          }
          zone.setFillStyle(0xffffff, 0.0001);
        });

        zone.on('pointerdown', () => {
          if (this.cooldownActive) {
            this.cameras.main.shake(150, 0.005);
            return;
          }

          const cellKey = `${x},${y}`;
          const currentMirror = this.placedMirrors[cellKey];
          const hasPrism = this.placedPrisms[cellKey];

          if (this.selectedTool === 'erase') {
            if (hasPrism) {
              this.onMoveAttempt(x, y, null, 'prism');
            } else if (currentMirror) {
              this.onMoveAttempt(x, y, null, 'mirror');
            }
          } else if (this.selectedTool === 'prism') {
            if (hasPrism) {
              this.onMoveAttempt(x, y, null, 'prism');
            } else {
              this.onMoveAttempt(x, y, '/' as MirrorType, 'prism');
            }
          } else {
            if (currentMirror === this.selectedMirrorType) {
              this.onMoveAttempt(x, y, null, 'mirror');
            } else {
              this.onMoveAttempt(x, y, this.selectedMirrorType, 'mirror');
            }
          }
        });

        this.tileOverlays.add(zone);
      }
    }
  }

  private drawLasers() {
    this.laserGraphics.clear();

    // 1. Calculate active laser path
    const activeResult = simulateLaser(this.levelConfig, this.placedMirrors, this.placedPrisms);
    
    // Draw real laser
    this.drawPath(activeResult.path, false, activeResult.targetsHit);

    // 2. Draw hover preview laser path if applicable
    const hover = this.hoverCell;
    if (hover && !this.cooldownActive) {
      const hKey = `${hover.x},${hover.y}`;
      const hasCurrentMirror = this.placedMirrors[hKey];
      const hasCurrentPrism = this.placedPrisms[hKey];
      
      const previewMirrors = { ...this.placedMirrors };
      const previewPrisms = { ...this.placedPrisms };
      let showPreview = false;

      if (this.selectedTool === 'erase') {
        if (hasCurrentMirror) {
          delete previewMirrors[hKey];
          showPreview = true;
        } else if (hasCurrentPrism) {
          delete previewPrisms[hKey];
          showPreview = true;
        }
      } else if (this.selectedTool === 'prism') {
        if (!hasCurrentPrism) {
          if (hasCurrentMirror) {
            delete previewMirrors[hKey];
          }
          previewPrisms[hKey] = true;
          showPreview = true;
        }
      } else {
        if (hasCurrentMirror !== this.selectedMirrorType) {
          if (hasCurrentPrism) {
            delete previewPrisms[hKey];
          }
          if (this.selectedMirrorType) {
            previewMirrors[hKey] = this.selectedMirrorType;
          } else {
            delete previewMirrors[hKey];
          }
          showPreview = true;
        }
      }

      if (showPreview) {
        // Draw ghost mirror in scene
        const previewResult = simulateLaser(this.levelConfig, previewMirrors, previewPrisms);
        this.drawPath(previewResult.path, true, previewResult.targetsHit);

        // Draw temporary preview indicator
        if (this.selectedTool === 'prism' && !hasCurrentPrism) {
          const tempContainer = this.createPrismContainer(hover.x, hover.y, true);
          this.time.delayedCall(16, () => tempContainer.destroy());
        } else if (this.selectedTool === 'mirror' && this.selectedMirrorType && hasCurrentMirror !== this.selectedMirrorType) {
          const tempContainer = this.createMirrorContainer(hover.x, hover.y, this.selectedMirrorType, true);
          this.time.delayedCall(16, () => tempContainer.destroy());
        }
      }
    }
  }

  private drawPath(path: Array<{ x: number; y: number }>, isPreview: boolean, isTargetHit: boolean) {
    if (path.length < 2 || !path[0]) return;

    const baseColor = isPreview ? 0xa855f7 : (isTargetHit ? 0x60a5fa : 0xef4444); // Blue/Green if solve, red for normal, purple for preview
    const coreColor = 0xffffff;

    // Pulsing factor
    const pulse = Math.sin(this.laserPulseTime) * 1.5 + 2.5;
    const outerWidth = isPreview ? 2.5 : 4.5 + pulse;
    const coreWidth = isPreview ? 1.0 : 1.5;

    const opacity = isPreview ? 0.45 : 0.9;

    // Draw glow outer beam
    this.laserGraphics.lineStyle(outerWidth, baseColor, opacity * 0.4);
    this.laserGraphics.beginPath();
    
    let startPx = this.gridOffset.x + path[0].x * this.cellSize + this.cellSize / 2;
    let startPy = this.gridOffset.y + path[0].y * this.cellSize + this.cellSize / 2;
    this.laserGraphics.moveTo(startPx, startPy);

    for (let i = 1; i < path.length; i++) {
      const pt = path[i];
      if (!pt) continue;
      const px = this.gridOffset.x + pt.x * this.cellSize + this.cellSize / 2;
      const py = this.gridOffset.y + pt.y * this.cellSize + this.cellSize / 2;
      this.laserGraphics.lineTo(px, py);
    }
    this.laserGraphics.strokePath();

    // Draw inner core beam
    this.laserGraphics.lineStyle(coreWidth, coreColor, opacity);
    this.laserGraphics.beginPath();
    this.laserGraphics.moveTo(startPx, startPy);

    for (let i = 1; i < path.length; i++) {
      const pt = path[i];
      if (!pt) continue;
      const px = this.gridOffset.x + pt.x * this.cellSize + this.cellSize / 2;
      const py = this.gridOffset.y + pt.y * this.cellSize + this.cellSize / 2;
      this.laserGraphics.lineTo(px, py);
    }
    this.laserGraphics.strokePath();

    // If target was hit and not preview, emit spark particles at the endpoint
    if (isTargetHit && !isPreview) {
      const endCell = path[path.length - 1];
      if (!endCell) return;
      const endPx = this.gridOffset.x + endCell.x * this.cellSize + this.cellSize / 2;
      const endPy = this.gridOffset.y + endCell.y * this.cellSize + this.cellSize / 2;

      this.laserParticles.setPosition(endPx, endPy);
      if (!this.laserParticles.emitting) {
        this.laserParticles.start();
      }
    } else if (!isPreview) {
      this.laserParticles.stop();
    }
  }
}
