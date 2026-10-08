# notes-01: gemini-3.5-flash

## Page 1: Data transfer Instructions
- frames: 0.3 s; best: 0.3 s; confidence 0.88; not flagged; 1 blocks
- Data transfer Instructions: Move destination, source Source can be register, memory location, immediate operand both can't be memory locatio

## Page 2: I2207 - SBB, CMP, MUL
- frames: 3.0 s; best: 3.0 s; confidence 0.9; not flagged; 2 blocks
- I2207 (2) 11.5.2025 - SBB destination, source: Subtract with Borrow/carry Like if the Carry flag CF = 1 it decrement the answer by 1 & Mov A

## Page 3: Division and variable declaration
- frames: 7.1 s; best: 7.1 s; confidence 0.88; not flagged; 1 blocks
- if source is word, (DX:AX) is divided by source, and AX = quotient DX = remainder - IDIV: it is signed division instruction Variable declara

## Page 4: If, else Condition and Logical Instructions
- frames: 8.4 s; best: 8.4 s; confidence 0.9; not flagged; 2 blocks
- I2207 (3) 17.5.2025 - If, else Condition: we use cmp to solve if-else in assembly cmp source, destination / to get the result of cmp then jx

## Page 5: Shift Arithmetic and Loops
- frames: 11.8 s; best: 11.8 s; confidence 0.89; not flagged; 1 blocks
- - SAR source, count (shift Arithmetic right) we add the new bit according to AL=10111001 the sign of the number, if it is negative SAR AL, 3

## Page 6: Propositional Logic and Semantic Tableaux
- frames: 12.7, 13.5 s; best: 12.7 s; confidence 0.85; FLAGGED: Hand partially covers lower semantic tableaux in frame 7; frame 6 is clear but slightly low contrast.; 4 blocks
- I2209 (1) 19.5.2025 Proposition: can be writen "p,q,r..." and it is a proposed statement Logical connections: - And (&): add two proposition

## Page 7: Rules of inference and Resolution
- frames: 15.2 s; best: 15.2 s; confidence 0.85; not flagged; 1 blocks
- branch is closed if there is x & ~x in the same root. Rules of inference: - Modus Ponens (law of detachment - mode that affirms): if a condi

## Page 8: Processor control instructions and Loops
- frames: 17.0 s; best: 17.0 s; confidence 0.9; not flagged; 2 blocks
- I2207 (4) 23.5.2025 Processor control instructions: STC: Set Carry flag to 1 STD: Set direction flag to 1 STI: Set Interrupt flag to 1 CLC: 
