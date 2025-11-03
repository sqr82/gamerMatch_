pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateMatchmaking is ZamaEthereumConfig {
    struct Player {
        address playerAddress;      
        euint32 encryptedKDA;       
        uint256 publicWins;         
        uint256 publicLosses;       
        uint256 timestamp;          
        uint32 decryptedKDA;        
        bool isVerified;            
    }

    mapping(address => Player) public players;
    address[] public playerAddresses;

    event PlayerRegistered(address indexed player, uint256 timestamp);
    event KDAVerified(address indexed player, uint32 decryptedKDA);

    constructor() ZamaEthereumConfig() {
    }

    function registerPlayer(
        externalEuint32 encryptedKDA,
        bytes calldata inputProof,
        uint256 publicWins,
        uint256 publicLosses
    ) external {
        require(players[msg.sender].playerAddress == address(0), "Player already registered");

        require(FHE.isInitialized(FHE.fromExternal(encryptedKDA, inputProof)), "Invalid encrypted KDA");

        players[msg.sender] = Player({
            playerAddress: msg.sender,
            encryptedKDA: FHE.fromExternal(encryptedKDA, inputProof),
            publicWins: publicWins,
            publicLosses: publicLosses,
            timestamp: block.timestamp,
            decryptedKDA: 0,
            isVerified: false
        });

        FHE.allowThis(players[msg.sender].encryptedKDA);
        FHE.makePubliclyDecryptable(players[msg.sender].encryptedKDA);

        playerAddresses.push(msg.sender);

        emit PlayerRegistered(msg.sender, block.timestamp);
    }

    function verifyKDA(
        bytes memory abiEncodedClearKDA,
        bytes memory decryptionProof
    ) external {
        require(players[msg.sender].playerAddress != address(0), "Player not registered");
        require(!players[msg.sender].isVerified, "KDA already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(players[msg.sender].encryptedKDA);

        FHE.checkSignatures(cts, abiEncodedClearKDA, decryptionProof);

        uint32 decodedKDA = abi.decode(abiEncodedClearKDA, (uint32));

        players[msg.sender].decryptedKDA = decodedKDA;
        players[msg.sender].isVerified = true;

        emit KDAVerified(msg.sender, decodedKDA);
    }

    function getEncryptedKDA(address player) external view returns (euint32) {
        require(players[player].playerAddress != address(0), "Player not found");
        return players[player].encryptedKDA;
    }

    function getPlayerData(address player) external view returns (
        uint256 publicWins,
        uint256 publicLosses,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedKDA
    ) {
        require(players[player].playerAddress != address(0), "Player not found");
        Player storage p = players[player];

        return (
            p.publicWins,
            p.publicLosses,
            p.timestamp,
            p.isVerified,
            p.decryptedKDA
        );
    }

    function getAllPlayers() external view returns (address[] memory) {
        return playerAddresses;
    }

    function calculateMatchScore(address player1, address player2) public view returns (uint32) {
        require(players[player1].playerAddress != address(0), "Player 1 not found");
        require(players[player2].playerAddress != address(0), "Player 2 not found");
        require(players[player1].isVerified, "Player 1 KDA not verified");
        require(players[player2].isVerified, "Player 2 KDA not verified");

        uint32 kda1 = players[player1].decryptedKDA;
        uint32 kda2 = players[player2].decryptedKDA;

        uint32 diff = kda1 > kda2 ? kda1 - kda2 : kda2 - kda1;
        uint32 maxKDA = kda1 > kda2 ? kda1 : kda2;

        return maxKDA == 0 ? 0 : (maxKDA - diff) * 100 / maxKDA;
    }

    function findBestMatch(address player) external view returns (address bestMatch, uint32 bestScore) {
        require(players[player].playerAddress != address(0), "Player not found");
        require(players[player].isVerified, "Player KDA not verified");

        bestScore = 0;
        bestMatch = address(0);

        for (uint i = 0; i < playerAddresses.length; i++) {
            address candidate = playerAddresses[i];
            if (candidate == player) continue;

            uint32 score = calculateMatchScore(player, candidate);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = candidate;
            }
        }

        return (bestMatch, bestScore);
    }
}

